import { desc, eq } from "drizzle-orm";
import { edlVersions, hashInputs, projects, type Db, type StageIdentity } from "@film/db";
import { validateEdl, type MusicTrackInfo } from "@film/edl";
import { getFormat } from "@film/formats";
import { resolveTrack } from "@film/music";
import { getTemplate, questionCardIds, toConformance, type SubjectData } from "@film/templates";

import { composeFilm, type IngestedAnswer, type StillAsset } from "../compose/plan.js";
import { permanent } from "../runtime/errors.js";
import type { StageContext } from "../runtime/runStage.js";
import {
  AssetSelectionSchema,
  buildManifest,
  filmAssets,
  isMusicBed,
  parseProjectConfig,
  qcOf,
  type AssetRow,
  type ProjectRow,
} from "../model.js";
import { loadAssets, loadProject } from "./context.js";

/**
 * Bump when the layout compose produces changes for the same inputs.
 *
 * 2: the cold open falls back to the opening of the answer when nobody typed
 * one. Without the bump, every film that already failed compose for want of
 * those words would keep its failed execution row and never be re-planned —
 * a fix in the code that changes nothing in the world.
 *
 * 3: a keepsake FILMED rather than photographed reaches the film. This one is
 * not about a failure — those films composed cleanly and validated without a
 * warning, which is why nobody noticed. Their compose rows say `succeeded`, so
 * without the bump the object they filmed stays missing from a film that the
 * system is quite sure it already made correctly.
 *
 * 4: the question appears on screen. Every film ever composed had
 * `promptSegments: []`, so nobody watching could tell what was being asked.
 * Same reason as 3 for the bump: those films did not fail, they were simply
 * missing something nobody could see was missing.
 */
export const COMPOSE_RECIPE = 4;

/**
 * Unlicensed music is refused unless someone has explicitly said otherwise.
 *
 * The temp bed exists so the edit can be judged before real tracks are
 * commissioned, and it must not be able to reach a customer by default. An
 * environment variable is the right shape for that: it is a deployment
 * decision, it is visible in the process, and production simply does not set
 * it.
 */
const allowsPlaceholderMusic = (): boolean => process.env["ALLOW_UNLICENSED_MUSIC"] === "1";

export const composeIdentity = (
  project: ProjectRow,
  rows: readonly AssetRow[],
  ingestHashes: ReadonlyMap<string, string>,
): StageIdentity => ({
  projectId: project.id,
  assetId: null,
  stage: "compose",
  inputHash: hashInputs({
    /**
     * The ingest output of every asset, so re-ingesting one take re-composes
     * the film rather than leaving it cut against media that no longer exists.
     *
     * Sorted by id HERE rather than trusting the caller's order. Two assets
     * inserted in the same statement share a created_at, and Postgres is then
     * free to return them either way round — which would change the hash, and
     * so re-run compose, for no reason at all.
     */
    assets: [...rows]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((r) => [r.id, ingestHashes.get(r.id) ?? "", r.selection] as const),
    templateId: project.templateId,
    templateVersion: project.templateVersion,
    subject: project.subjectData,
    config: project.config,
    recipe: COMPOSE_RECIPE,
  }),
});

/**
 * Lay the template's beats out over what was actually recorded.
 *
 * Pure given its inputs: the same assets and the same config produce the same
 * document, byte for byte. That is what makes the input hash meaningful and
 * what lets a retry be free.
 */
export const runCompose = async (ctx: StageContext): Promise<string | null> => {
  const project = await loadProject(ctx.db, ctx.projectId);
  const rows = await loadAssets(ctx.db, ctx.projectId);
  if (rows.length === 0) throw permanent("the project has no assets");

  const template = getTemplate(project.templateId, project.templateVersion);
  const format = getFormat(template.defaultFormatId);

  const notIngested = rows.filter((r) => r.normalisedKey === null);
  if (notIngested.length > 0) {
    // The dispatcher should not have got here. Transient rather than permanent
    // so a race between ingest finishing and compose starting resolves itself.
    throw new Error(
      `${String(notIngested.length)} asset(s) have not been ingested; compose was dispatched early`,
    );
  }

  const answers: IngestedAnswer[] = [];
  const stills: StillAsset[] = [];
  const brollAssetIds: Record<string, string> = {};
  let track: MusicTrackInfo | null = null;

  for (const row of rows) {
    const qc = qcOf(row);

    if (isMusicBed(row)) {
      if (qc.musicTrack === undefined) throw permanent("the music bed was ingested without a track");
      track = qc.musicTrack;
      continue;
    }

    if (row.kind === "interview") {
      const selection = AssetSelectionSchema.safeParse(row.selection);
      if (!selection.success) {
        throw permanent(
          `answer ${row.questionId ?? row.id} has no usable text: ${selection.error.issues[0]?.message ?? "missing"}`,
        );
      }
      answers.push({
        questionId: row.questionId ?? row.id,
        assetId: row.id,
        durationMs: qc.durationMs ?? 0,
        runs: qc.speechRuns ?? [],
        spoken: selection.data.spoken,
        ...(selection.data.coldOpen === undefined ? {} : { coldOpen: selection.data.coldOpen }),
        ...(selection.data.emphasis === undefined ? {} : { emphasis: selection.data.emphasis }),
      });
    } else if (row.kind === "photo") {
      stills.push({ assetId: row.id, slotId: row.slotId ?? row.id });
    } else if (row.kind === "video") {
      brollAssetIds[row.slotId ?? row.id] = row.id;
    }
  }

  if (track === null) throw permanent("the project has no music bed");
  const config = parseProjectConfig(project.config);

  const { edl, notes } = composeFilm({
    projectId: project.id,
    template,
    answers,
    stills,
    brollAssetIds,
    assetDurationMs: Object.fromEntries(
      filmAssets(rows).flatMap((r) => {
        const ms = qcOf(r).durationMs;
        return ms === undefined ? [] : [[r.id, ms] as const];
      }),
    ),
    track,
    /**
     * The template decides unless the project overrides it.
     *
     * `questionCardIds` lives in @film/templates because it needs the SUBJECT:
     * a question whose wording does not resolve for this person — the bonus
     * question needs an interviewer's name most films do not have — must not
     * get a card, or the renderer would look up a text key that
     * `resolveAllText` deliberately left out. Both sides ask the same function,
     * so they cannot disagree.
     */
    promptQuestionIds:
      config.questionPrompts ?? questionCardIds(template, project.subjectData as SubjectData),
  });
  for (const note of notes) await ctx.log.info(`note: ${note}`);

  const resolvedTrack = track;
  const result = validateEdl(edl, {
    manifest: buildManifest(rows),
    format,
    conformance: toConformance(template),
    resolveMusicTrack: (id: string) => (id === resolvedTrack.id ? resolvedTrack : resolveTrack(id)),
    allowPlaceholderMusic: allowsPlaceholderMusic(),
  });

  // Warnings never block — they are notes the customer gets to weigh — but
  // they must be visible, or "it validated" quietly comes to mean nothing.
  for (const w of result.warnings) await ctx.log.warn(`${w.code} at ${w.path} — ${w.message}`);
  if (!result.ok) {
    throw permanent(
      `the composed edit is not valid: ${result.errors
        .slice(0, 3)
        .map((e) => `${e.code} at ${e.path}`)
        .join(", ")}`,
    );
  }

  const doc = result.edl;
  const version = await appendVersion(ctx.db, project.id, doc);

  await ctx.db
    .update(projects)
    .set({ status: "awaiting_approval", updatedAt: new Date() })
    .where(eq(projects.id, project.id));

  const mins = Math.floor(doc.totalDurationMs / 60000);
  const secs = Math.round((doc.totalDurationMs % 60000) / 1000);
  await ctx.log.info(
    `v${String(version)}: ${String(doc.visualSegments.length)} visual, ` +
      `${String(doc.speechSegments.length)} speech, ` +
      `${String(doc.promptSegments.length)} prompt — ` +
      `${String(mins)}:${String(secs).padStart(2, "0")}`,
  );

  return hashInputs({ doc });
};

/**
 * Append a version, unless the newest one already says the same thing.
 *
 * edl_versions is append-only and approval is written against a specific
 * version, so churning out an identical version on every retry would silently
 * supersede a cut the customer is looking at — and the approval flow would
 * refuse their click as stale for no reason at all.
 */
const appendVersion = async (db: Db, projectId: string, doc: unknown): Promise<number> => {
  const latest = await db
    .select({ version: edlVersions.version, doc: edlVersions.doc })
    .from(edlVersions)
    .where(eq(edlVersions.projectId, projectId))
    .orderBy(desc(edlVersions.version))
    .limit(1);

  const previous = latest[0];
  if (previous !== undefined && JSON.stringify(previous.doc) === JSON.stringify(doc)) {
    return previous.version;
  }

  const version = (previous?.version ?? 0) + 1;
  await db.insert(edlVersions).values({ projectId, version, doc, author: "compose" });
  return version;
};

/** The subject data the template interpolates, parsed out of the project row. */
export const subjectOf = (project: ProjectRow): SubjectData => project.subjectData as SubjectData;
