import "server-only";

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  approvals,
  assets,
  deliverableFilm,
  deliveryRenders,
  edlVersions,
  filmFilename,
  isProjectId,
  projects,
  subjectNameOf,
  type Db,
} from "@film/db";
import { EdlSchema, type EDL } from "@film/edl";
/**
 * The narrow subpath, never the package root.
 *
 * `@film/pipeline` re-exports every stage, which drags Remotion's bundler and
 * renderer — and the binaries they carry — into the Next server graph. The
 * symptom is not a slow build but a flat refusal:
 * `Module parse failed: Unexpected character` on a file webpack was never
 * meant to see. This is what the subpath exports are for.
 */
import { retryProject } from "@film/pipeline/retry";
import { fittedAnswers, type IngestedAnswer } from "@film/editors";
import { AssetSelectionSchema, buildManifest, isMusicBed, qcOf } from "@film/pipeline/model";
import { storeFromEnv, usingLocalStore, type ObjectStore } from "@film/storage";
import { getTemplate, resolveCaptureSteps, type SubjectData } from "@film/templates";

import { wordedWarning } from "./capture.js";
// From "./props", not "./composition".
//
// The composition entry pulls in React and Remotion, and importing it for a
// value here drags the whole renderer into the server module graph — where
// Next's page-data collection runs it outside a React tree and Remotion fails
// on a missing createContext. The props builder needs none of that.
import { buildProjectProps } from "@film/render/props";
import type { FilmProps } from "@film/render/composition";
import { webDb } from "./db.js";

/**
 * The browser never talks to Postgres.
 *
 * Supabase Auth supplies identity and session, not a client-side data layer.
 * Every read goes through server code, and "server-only" makes importing this
 * from a client component a build error rather than a runtime surprise.
 */

const db = webDb;

/**
 * The same store the worker writes to.
 *
 * Shared factory rather than one construction per caller: if the app and the
 * worker disagree about the root, the symptom is a blank preview with no error
 * anywhere, which is a genuinely hard afternoon.
 */
export const store = (): ObjectStore => storeFromEnv();

/** Another go at a film that could not be made. The rule is in @film/pipeline,
 *  where it is tested against a real database. */
export const retryFilm = async (
  projectId: string,
): Promise<{ readonly ok: true; readonly reopened: number } | { readonly ok: false; readonly error: string }> =>
  retryProject(db(), projectId);

export type AssetWarning = {
  readonly assetId: string;
  readonly label: string;
  readonly code: string;
  readonly message: string;
};

export type ProjectSummary = {
  readonly id: string;
  /** Who owns this project. With no auth, this is also who approves it. */
  readonly ownerId: string;
  readonly status: string;
  readonly templateId: string;
  readonly templateVersion: number;
  readonly subject: SubjectData;
  readonly edlVersion: number;
  readonly edlVersionId: string;
  readonly approved: boolean;
  readonly warnings: AssetWarning[];
  /** Answers that lost words to fit their share of the film, and what went. */
  readonly fitted: readonly FittedNote[];
};

/** One shortened answer, as the preview tells it. */
export type FittedNote = {
  readonly questionId: string;
  /** The question as the walk-through asked it. */
  readonly label: string;
  readonly usedMs: number;
  readonly spokenMs: number;
  readonly leftOut: readonly string[];
};

/**
 * Somebody's films, or every film when nobody can sign in.
 *
 * The owner filter is not optional decoration: without it the front page is a
 * directory of other people's recordings. `ownerId` undefined means auth is not
 * configured — the development arrangement, which the page says out loud.
 */
export type FilmListing = {
  readonly id: string;
  readonly status: string;
  /** What the person calls them — "Tim" — falling back to the full name. */
  readonly name: string | null;
  /** A small still for the card: the thumbnail of a photograph if there is
   *  one, else of anything. Never an original. */
  readonly posterKey: string | null;
};

export const listProjects = async (ownerId?: string): Promise<FilmListing[]> => {
  const rows = await db()
    .select({ id: projects.id, status: projects.status, subjectData: projects.subjectData })
    .from(projects)
    .where(ownerId === undefined ? undefined : eq(projects.ownerId, ownerId))
    .orderBy(desc(projects.createdAt))
    .limit(50);

  /**
   * One query for every card's picture, not one per card. Photographs first,
   * because a film's card should show the person rather than a frame of an
   * interview mid-blink.
   */
  const posters = new Map<string, string>();
  if (rows.length > 0) {
    const stills = await db()
      .select({ projectId: assets.projectId, key: assets.thumbnailKey, kind: assets.kind })
      .from(assets)
      .where(
        and(
          inArray(
            assets.projectId,
            rows.map((r) => r.id),
          ),
          isNotNull(assets.thumbnailKey),
        ),
      )
      .orderBy(sql`case when ${assets.kind} = 'photo' then 0 else 1 end`, assets.createdAt);
    for (const still of stills) {
      if (still.key !== null && !posters.has(still.projectId)) posters.set(still.projectId, still.key);
    }
  }

  return rows.map((r) => {
    const subject = r.subjectData as { subjectName?: string; displayName?: string };
    return {
      id: r.id,
      status: r.status,
      name: subject.displayName ?? subject.subjectName ?? null,
      posterKey: posters.get(r.id) ?? null,
    };
  });
};

/**
 * A project, its newest EDL, and everything needed to preview it.
 *
 * Asset URLs are resolved HERE, immediately before preview — they never live
 * in the EDL, which carries only stable ids. In production they are short-TTL
 * signed URLs; locally they are routed through this app so private storage is
 * never exposed directly.
 */
export const loadProjectForPreview = async (
  projectId: string,
): Promise<{ summary: ProjectSummary; props: FilmProps } | null> => {
  // Not found, not a server error: the id came from the URL bar.
  if (!isProjectId(projectId)) return null;

  /**
   * The three reads that need only the project id, at once. They were four
   * round trips in a row; now two, because only the approval waits on the
   * version it belongs to.
   */
  const [projectRows, versionRows, assetRows] = await Promise.all([
    db().select().from(projects).where(eq(projects.id, projectId)).limit(1),
    db()
      .select()
      .from(edlVersions)
      .where(eq(edlVersions.projectId, projectId))
      .orderBy(desc(edlVersions.version))
      .limit(1),
    db().select().from(assets).where(eq(assets.projectId, projectId)),
  ]);
  const project = projectRows[0];
  if (project === undefined) return null;
  const latest = versionRows[0];
  if (latest === undefined) return null;

  const approvalRows = await db()
    .select({ id: approvals.id })
    .from(approvals)
    .where(eq(approvals.edlVersionId, latest.id))
    .limit(1);

  // Parsed, not trusted. The document was validated when it was written, but a
  // stored jsonb column is still an untyped boundary on the way back in.
  const edl: EDL = EdlSchema.parse(latest.doc);
  const subject = project.subjectData as SubjectData;

  /**
   * Assets are served from what INGEST produced, never the original — and, once
   * the preview stage has made one, from the light copy of it.
   *
   * The original is whatever the customer's phone recorded — variable frame
   * rate, rotation in a container tag, wildly uneven levels — and the film is
   * cut against the normalised file. The preview copy is that file at 720p
   * with a keyframe every second, the same frames at the same times, so the
   * edit plays identically and a cut into a take starts at once. Until it
   * exists, the normalised file, so no film is unwatchable for want of it.
   *
   * Signed for three hours, not fifteen minutes: somebody watches the cut,
   * reads the notes, makes a cup of tea, and comes back to watch it again.
   * With fifteen minutes the second viewing failed part-way, when the player
   * reached a clip whose URL had expired. Still one key and one method each,
   * still a private bucket.
   */
  const objects = store();
  const PREVIEW_URL_SECONDS = 3 * 60 * 60;
  const resolve = async (key: string): Promise<string> =>
    usingLocalStore()
      ? `/api/media/${key}`
      : objects.signedGetUrl(key, { expiresInSeconds: PREVIEW_URL_SECONDS });

  const assetPaths: Record<string, string> = {};
  let musicPath = "";
  await Promise.all(
    assetRows.map(async (asset) => {
      if (isMusicBed(asset)) {
        musicPath = await resolve(asset.normalisedKey ?? asset.storageKey);
        return;
      }
      assetPaths[asset.id] = await resolve(asset.previewKey ?? asset.normalisedKey ?? asset.storageKey);
    }),
  );

  const bed = assetRows.find(isMusicBed);
  /**
   * Named the way the walk-through named them — "Add a photo of the person
   * from another time", not `photo_early` — and worded the way the overview
   * worded them. A slot id and a pixel count were what the approval screen
   * used to show the one person it exists for.
   */
  const askOf = new Map(
    resolveCaptureSteps(getTemplate(project.templateId, project.templateVersion), subject).map(
      (step) => [step.id, step.ask] as const,
    ),
  );
  const warnings: AssetWarning[] = assetRows.flatMap((asset) => {
    const list = (asset.warnings ?? []) as { code?: string; message?: string }[];
    const id = asset.questionId ?? asset.slotId;
    return list.map((w) => ({
      assetId: asset.id,
      label: (id === null ? undefined : askOf.get(id)) ?? "One of your recordings",
      code: w.code ?? "WARNING",
      message: wordedWarning(w.code ?? "", w.message ?? ""),
    }));
  });

  /**
   * The same props builder the worker uses.
   *
   * "Preview is the same composition as delivery" is what makes approving in a
   * browser mean anything, and it does not survive two places assembling the
   * props. Only the paths differ: signed URLs here, local files there.
   */
  const props = buildProjectProps({
    edl,
    manifest: buildManifest(assetRows),
    subject,
    templateId: project.templateId,
    templateVersion: project.templateVersion,
    assetPaths,
    musicPath,
    ...(bed === undefined ? {} : { musicTrack: qcOf(bed).musicTrack }),
    allowPlaceholderMusic: process.env["ALLOW_UNLICENSED_MUSIC"] === "1",
  });

  return {
    summary: {
      fitted: fittedNotes(edl, assetRows, askOf),
      id: project.id,
      ownerId: project.ownerId,
      status: project.status,
      templateId: project.templateId,
      templateVersion: project.templateVersion,
      subject,
      edlVersion: latest.version,
      edlVersionId: latest.id,
      approved: approvalRows.length > 0,
      warnings,
    },
    props,
  };
};

/**
 * What the customer should be told about their film, in the four states a
 * project can actually be in.
 *
 * Derived from rows rather than from `projects.status`, because the status
 * column moves for reasons that are not about delivery. The states are the
 * ones the schema can really produce: a render row is only ever written as
 * "queued" or "succeeded", and a run that gives up marks the PROJECT failed —
 * so there is no "the render failed" state to show, and inventing one would
 * mean writing a branch that never runs.
 */
export type DeliveryState =
  | { readonly kind: "unapproved" }
  | { readonly kind: "rendering" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly filename: string;
      /** Null when the object has gone missing under a row that claims it. */
      readonly byteSize: number | null;
    };

export const loadDelivery = async (projectId: string): Promise<DeliveryState | null> => {
  if (!isProjectId(projectId)) return null;

  // Null means "no such project", which is not the same as "no film yet" —
  // otherwise the polling route answers happily about projects that do not
  // exist, and a real state becomes indistinguishable from a typo.
  // Asked together: the delivery panel polls this, so each round trip saved
  // is saved every few seconds for as long as somebody waits.
  const [statusRows, film] = await Promise.all([
    db().select({ status: projects.status }).from(projects).where(eq(projects.id, projectId)).limit(1),
    deliverableFilm(db(), projectId),
  ]);
  const status = statusRows[0]?.status;
  if (status === undefined) return null;

  if (film !== null) {
    // Heading the object rather than trusting the row. A half-failed upload
    // leaves a row pointing at nothing, and the download button should not be
    // the thing that discovers it.
    const [subjectName, head] = await Promise.all([
      subjectNameOf(db(), projectId),
      store().head(film.outputKey),
    ]);
    const filename = filmFilename({ subjectName, edlVersion: film.edlVersion });
    return { kind: "ready", filename, byteSize: head?.byteSize ?? null };
  }

  if (status === "failed") return { kind: "failed" };

  // A requested delivery render that has not landed yet. Approval and the
  // render row are written in one transaction, so one implies the other.
  const requested = await deliveryRenders(db(), projectId);
  return requested.length > 0 ? { kind: "rendering" } : { kind: "unapproved" };
};

/**
 * What the cut left out of each answer, for the preview, worked out from the
 * cut and the words (`fittedAnswers` in @film/editors) rather than kept
 * anywhere — so it is always the truth about the cut being shown.
 *
 * The answers are rebuilt from the rows exactly as compose builds them: the
 * measured speech, and the words with their times where transcription kept
 * them. A row whose words do not parse is simply not reported.
 */
const fittedNotes = (
  edl: EDL,
  rows: readonly (typeof assets.$inferSelect)[],
  askOf: ReadonlyMap<string, string>,
): FittedNote[] => {
  const answers: IngestedAnswer[] = rows.flatMap((row) => {
    if (row.kind !== "interview") return [];
    const selection = AssetSelectionSchema.safeParse(row.selection);
    if (!selection.success) return [];
    const qc = qcOf(row);
    return [
      {
        questionId: row.questionId ?? row.id,
        assetId: row.id,
        durationMs: qc.durationMs ?? 0,
        runs: qc.speechRuns ?? [],
        spoken: selection.data.spoken,
        ...(selection.data.words === undefined ? {} : { words: selection.data.words }),
      },
    ];
  });
  return fittedAnswers(edl, answers).map((f) => ({
    questionId: f.questionId,
    label: askOf.get(f.questionId) ?? "One of the answers",
    usedMs: f.usedMs,
    spokenMs: f.spokenMs,
    leftOut: f.leftOut,
  }));
};
