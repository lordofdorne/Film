import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { eq } from "drizzle-orm";
import { assets, projects, users, type Db } from "@film/db";
import { objectKey, type ObjectStore } from "@film/storage";
import type { SubjectData } from "@film/templates";

import {
  AssetSelectionSchema,
  MUSIC_BED_SLOT,
  ProjectConfigSchema,
  type AssetSelection,
  type ProjectConfig,
} from "./model.js";

export type IntakeAsset = {
  readonly kind: "interview" | "photo" | "video" | "audio";
  /** Interview takes and interviewer prompts bind to a question. */
  readonly questionId?: string;
  /** Photographs, b-roll and the music bed bind to a named slot. */
  readonly slotId?: string;
  /** A local file to upload. */
  readonly path: string;
  readonly contentType?: string;
  /**
   * The words spoken in this take.
   *
   * Supplied by the caller today because there is no transcription step. Phase
   * 4 replaces the source, not the shape.
   */
  readonly selection?: AssetSelection;
};

export type IntakeInput = {
  readonly ownerEmail: string;
  readonly templateId: string;
  readonly templateVersion: number;
  readonly subject: SubjectData;
  readonly config: ProjectConfig;
  readonly assets: readonly IntakeAsset[];
};

export type IntakeResult = {
  readonly projectId: string;
  readonly ownerId: string;
  readonly assetIds: readonly string[];
};

/**
 * Everything that must be true before a project is worth starting.
 *
 * Checked here rather than left to compose, because a project that cannot
 * possibly produce a film should never reach the queue at all — the customer
 * would watch it grind through ten ingests and then fail.
 */
const validate = (input: IntakeInput): void => {
  const problems: string[] = [];
  const takes = input.assets.filter((a) => a.kind === "interview");
  if (takes.length === 0) problems.push("no interview takes");

  const seen = new Map<string, number>();
  for (const asset of input.assets) {
    const binding = asset.questionId ?? asset.slotId;
    if (binding === undefined) {
      problems.push(`a ${asset.kind} asset has neither a questionId nor a slotId`);
      continue;
    }
    seen.set(`${asset.kind}:${binding}`, (seen.get(`${asset.kind}:${binding}`) ?? 0) + 1);
    if (asset.kind === "interview" && asset.selection === undefined) {
      problems.push(`take "${binding}" has no spoken text`);
    }
    if (asset.selection !== undefined) AssetSelectionSchema.parse(asset.selection);
  }
  for (const [binding, count] of seen) {
    if (count > 1) problems.push(`${String(count)} assets claim "${binding}"`);
  }

  const beds = input.assets.filter((a) => a.slotId === MUSIC_BED_SLOT);
  if (beds.length > 1) problems.push("more than one music bed");
  if (beds.length === 1 && input.config.music === undefined) {
    problems.push("a music bed was supplied but the config says nothing about how to build it");
  }
  if (beds.length === 0) problems.push("no music bed");

  if (problems.length > 0) {
    throw new Error(`this project cannot be started:\n  ${problems.join("\n  ")}`);
  }
};

/**
 * Create a project from files, without anyone editing JSON.
 *
 * This is the front door. Everything after it is the worker's business: the
 * project lands in `processing` with its originals in storage, and the
 * dispatcher picks it up on the next tick.
 *
 * Objects are uploaded BEFORE their rows are written. The two orders fail
 * differently and only one of them is survivable — an orphaned object is
 * invisible and sweepable, whereas a row pointing at nothing is a project that
 * fails at ingest for a reason nobody can see from the database.
 */
export const createProject = async (
  deps: { readonly db: Db; readonly store: ObjectStore },
  input: IntakeInput,
): Promise<IntakeResult> => {
  validate(input);
  const config = ProjectConfigSchema.parse(input.config);

  const ownerId = await ensureUser(deps.db, input.ownerEmail);
  const projectId = randomUUID();

  const uploaded: (typeof assets.$inferInsert)[] = [];
  for (const asset of input.assets) {
    const assetId = randomUUID();
    const bytes = await readFile(asset.path);
    const key = objectKey({
      projectId,
      kind: "original",
      assetId,
      // Not the customer's filename: it is untrusted, it can carry a path, and
      // nothing downstream needs it. contentType carries what matters.
      name: `source${extname(asset.path).toLowerCase() || ".bin"}`,
    });

    const stored = await deps.store.put(key, new Uint8Array(bytes), {
      ...(asset.contentType === undefined ? {} : { contentType: asset.contentType }),
      contentLength: bytes.byteLength,
    });

    uploaded.push({
      id: assetId,
      projectId,
      kind: asset.kind,
      ...(asset.questionId === undefined ? {} : { questionId: asset.questionId }),
      ...(asset.slotId === undefined ? {} : { slotId: asset.slotId }),
      storageKey: key,
      byteSize: stored.byteSize,
      etag: stored.etag,
      // Computed here, server-side. A client's claim about its own upload is
      // not evidence of anything.
      sha256: createHash("sha256").update(bytes).digest("hex"),
      ...(asset.contentType === undefined ? {} : { contentType: asset.contentType }),
      captureMethod: "native_upload",
      ...(asset.selection === undefined ? {} : { selection: asset.selection }),
    });
  }

  await deps.db.transaction(async (tx) => {
    await tx.insert(projects).values({
      id: projectId,
      ownerId,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      subjectData: input.subject,
      config,
      // Straight to processing: every original is already in storage, so there
      // is nothing left to wait for and the dispatcher can take it now.
      status: "processing",
    });
    await tx.insert(assets).values(uploaded);
  });

  return { projectId, ownerId, assetIds: uploaded.map((a) => a.id as string) };
};

/**
 * The application's user row, which mirrors an identity provider's.
 *
 * Created on demand for now because there is no auth: the owner is whoever ran
 * intake. When Supabase Auth arrives the id comes from auth.users and this
 * becomes a lookup, not an insert.
 */
export const ensureUser = async (db: Db, rawEmail: string): Promise<string> => {
  // Lower-cased, because sign-in looks this row up by the address the identity
  // provider verified — and providers hand back a normalised one. Two rows
  // differing only in case would mean signing in and not finding your films.
  const email = rawEmail.trim().toLowerCase();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  const found = existing[0];
  if (found !== undefined) return found.id;

  const id = randomUUID();
  await db.insert(users).values({ id, email });
  return id;
};
