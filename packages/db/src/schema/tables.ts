import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Application tables only.
 *
 * pg-boss owns its own tables in a separate schema and is NEVER managed by
 * Drizzle — it creates and migrates them itself, and letting Drizzle near them
 * produces migrations that fight the queue at deploy time.
 *
 * Supabase Auth owns auth.users. The application `users` table references it by
 * id rather than duplicating identity.
 */

export const projectStatus = pgEnum("project_status", [
  "draft",
  "capturing",
  "processing",
  "awaiting_approval",
  "approved",
  "rendering",
  "delivered",
  "failed",
]);

export const assetKind = pgEnum("asset_kind", ["interview", "photo", "video", "audio"]);

/** How the media arrived — measures which capture path customers finish. */
export const captureMethod = pgEnum("capture_method", ["browser", "native_upload"]);

export const stageName = pgEnum("stage_name", [
  "ingest",
  "qc",
  "transcribe",
  "select",
  "compose",
  "render",
  "deliver",
]);

export const stageStatus = pgEnum("stage_status", [
  "claimed",
  "running",
  "succeeded",
  "failed",
]);

/**
 * Why a stage failed, which decides whether retrying can possibly help.
 * Conflating these either spams retries at unfixable input or gives up on a
 * transient blip.
 */
export const failureClass = pgEnum("failure_class", [
  "permanent",
  "transient",
  "cancelled",
]);

export const uploadStatus = pgEnum("upload_status", [
  "in_progress",
  "completed",
  "aborted",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    /**
     * Null for an anonymous user — somebody who pressed Start and has not yet
     * proved an address. The unique constraint below ignores NULLs, so any
     * number of anonymous rows coexist while a verified address still cannot
     * belong to two rows.
     */
    email: text("email"),
    /**
     * The Supabase Auth identity, once there is one. Null until somebody signs
     * in.
     *
     * Not the primary key, though the two could have been the same thing. A
     * user row exists before any sign-in — intake creates one from an email
     * address, and capture creates one the moment somebody types theirs at
     * /start — so identity has to be something that can arrive later and be
     * linked to a row that already owns films. Making it the primary key would
     * mean rewriting a key that projects already reference, on the one code
     * path that runs while a customer is waiting.
     *
     * Unique: two people cannot share an identity, and one identity cannot be
     * spread over two rows.
     */
    authId: uuid("auth_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Sign-in looks a user up by the address the identity provider verified, so
    // that lookup is on the hot path of every first sign-in.
    unique("users_email_unique").on(t.email),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Both are stored: a project is pinned to the template version it was cut
     *  against, and that version is never mutated afterwards. */
    templateId: text("template_id").notNull(),
    templateVersion: integer("template_version").notNull(),
    subjectData: jsonb("subject_data").notNull(),
    /** Edit decisions that are not subject data: which questions get a prompt
     *  card, which music bed to build. Keeping them out of subject_data is
     *  what stops the template's schema having to know about the pipeline. */
    config: jsonb("config").notNull().default({}),
    status: projectStatus("status").notNull().default("draft"),
    /**
     * Where the finished film should go, typed as a step of the walk-through.
     * Deliberately not users.email: that column is unique and decides who owns
     * which films, and an address typed mid-capture is unverified. Clicking the
     * magic link is what turns this address into an identity.
     */
    deliverTo: text("deliver_to"),
    stripePaymentId: text("stripe_payment_id"),
    /** Raw recordings may be irreplaceable. Never delete while active; warn
     *  before this passes. */
    retentionExpiresAt: timestamp("retention_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("projects_owner_idx").on(t.ownerId),
    // The reconciler sweeps on (status, updatedAt) looking for work that
    // stalled, so that pair is the hot path rather than an afterthought.
    index("projects_status_updated_idx").on(t.status, t.updatedAt),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Interview clips bind to a question; photos and b-roll to a named slot. */
    questionId: text("question_id"),
    slotId: text("slot_id"),
    kind: assetKind("kind").notNull(),
    /** Computed server-side after upload. The browser never asserts this. */
    sha256: text("sha256"),
    /** The customer's original. Never overwritten — raw takes may be
     *  irreplaceable, and a bad normalisation recipe must be re-runnable. */
    storageKey: text("storage_key").notNull(),
    /** What ingest produced from it. Null until ingest has run. */
    normalisedKey: text("normalised_key"),
    contentType: text("content_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    etag: text("etag"),
    captureMethod: captureMethod("capture_method"),
    qcMetrics: jsonb("qc_metrics"),
    warnings: jsonb("warnings"),
    transcriptKey: text("transcript_key"),
    selection: jsonb("selection"),
    aiProvenance: jsonb("ai_provenance"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assets_project_idx").on(t.projectId),
    index("assets_project_question_idx").on(t.projectId, t.questionId),
  ],
);

export const uploadSessions = pgTable(
  "upload_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }),
    /** The multipart upload id from the object store. */
    uploadId: text("upload_id").notNull(),
    status: uploadStatus("status").notNull().default("in_progress"),
    /** [{ partNumber, etag, byteStart, byteEnd }] — persisted as they land so a
     *  refresh mid-recording does not lose the take. */
    parts: jsonb("parts").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("upload_sessions_project_idx").on(t.projectId),
    // Abandoned uploads cost money until aborted; this is the sweep index.
    index("upload_sessions_status_created_idx").on(t.status, t.createdAt),
  ],
);

/**
 * The source of truth for pipeline progress.
 *
 * pg-boss is a queue, NOT the source of truth. If the queue is drained or
 * rebuilt, remaining work is reconstructed from these rows — which is only
 * possible because the row is written before the work starts, not after.
 */
export const stageExecutions = pgTable(
  "stage_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Null for project-wide stages (compose, render, deliver). */
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }),
    stage: stageName("stage").notNull(),
    /** Content hash of everything the stage consumes. Same inputs, same row. */
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash"),
    status: stageStatus("status").notNull().default("claimed"),
    attempt: integer("attempt").notNull().default(1),
    failureClass: failureClass("failure_class"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * Exactly-once. A worker inserts this row and only proceeds if the insert
     * won; a duplicate delivery loses the race and returns without doing the
     * work twice. Postgres enforces it, not application logic.
     *
     * NOTE: assetId is nullable, and Postgres treats NULLs as distinct in a
     * unique index — so project-wide stages need `nulls not distinct`, applied
     * in the migration. Without it, "compose" could run twice.
     */
    unique("stage_executions_identity").on(t.projectId, t.assetId, t.stage, t.inputHash),
    index("stage_executions_project_idx").on(t.projectId),
    index("stage_executions_status_updated_idx").on(t.status, t.updatedAt),
  ],
);

export const stageEvents = pgTable(
  "stage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stageExecutionId: uuid("stage_execution_id")
      .notNull()
      .references(() => stageExecutions.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    level: text("level").notNull(),
    message: text("message").notNull(),
    data: jsonb("data"),
  },
  (t) => [index("stage_events_execution_idx").on(t.stageExecutionId, t.ts)],
);

/** Append-only. An edit never mutates media or a previous version. */
export const edlVersions = pgTable(
  "edl_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    doc: jsonb("doc").notNull(),
    /** "compose" | "customer" | a user id — who caused this version. */
    author: text("author").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("edl_versions_project_version").on(t.projectId, t.version)],
);

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  edlVersionId: uuid("edl_version_id")
    .notNull()
    .references(() => edlVersions.id, { onDelete: "restrict" }),
  approvedBy: uuid("approved_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const renders = pgTable(
  "renders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    edlVersionId: uuid("edl_version_id")
      .notNull()
      .references(() => edlVersions.id, { onDelete: "cascade" }),
    formatId: text("format_id").notNull(),
    /** "preview" is watermarked and may run before payment; "delivery" may not. */
    quality: text("quality").notNull(),
    outputKey: text("output_key"),
    status: text("status").notNull().default("queued"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("renders_edl_version_idx").on(t.edlVersionId)],
);

/** Stripe redelivers webhooks; this makes handling them idempotent. */
export const stripeEvents = pgTable("stripe_events", {
  stripeEventId: text("stripe_event_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const consents = pgTable("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  subjectName: text("subject_name").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  ip: text("ip"),
  termsVersion: text("terms_version").notNull(),
});

export const deletionRequests = pgTable("deletion_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  /** Both timestamps are stored: a deletion is a promise with an audit trail. */
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
