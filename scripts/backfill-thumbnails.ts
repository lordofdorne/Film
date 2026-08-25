/**
 * Make a thumbnail for every asset that predates thumbnails.
 *
 *   pnpm thumbs:backfill          # say what it would do
 *   pnpm thumbs:backfill --run    # enqueue it
 *
 * A one-off, and it exists because the dispatcher deliberately will not do
 * this. It plans work for ACTIVE projects only — a delivered film is finished,
 * and a dispatcher that swept every finished film on every five-second tick
 * would grind through the whole archive forever to find nothing.
 *
 * But a delivered film still has a hub, and the customer still opens it to
 * download their film. Before this, that page referenced 225 MB of originals to
 * draw eighteen 56-pixel squares. Those are exactly the projects the dispatcher
 * cannot reach, so they are reached once, by hand, here.
 *
 * The work itself is the ordinary thumbnail stage: this only enqueues. Nothing
 * in the pipeline is done twice, because claim-then-work refuses a duplicate
 * and the stage skips an asset that already has one.
 */
import { isNull, sql } from "drizzle-orm";

import { assets, createDb } from "@film/db";
import { hasPicture, thumbnailIdentity } from "@film/pipeline";
import { createQueue, ensureQueues, enqueueStage } from "@film/queue";

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const main = async (): Promise<void> => {
  const commit = process.argv.includes("--run");
  const { db, pool } = createDb("web");

  try {
    const rows = await db
      .select()
      .from(assets)
      .where(isNull(assets.thumbnailKey))
      .orderBy(sql`${assets.createdAt} desc`);

    const wanted = rows.filter((row) => hasPicture(row));
    const skipped = rows.length - wanted.length;

    log(
      `${String(wanted.length)} asset(s) want a thumbnail` +
        (skipped > 0 ? ` (${String(skipped)} skipped — sound has no frame in it)` : ""),
    );
    if (wanted.length === 0) return;

    const byProject = new Map<string, number>();
    for (const row of wanted) {
      byProject.set(row.projectId, (byProject.get(row.projectId) ?? 0) + 1);
    }
    for (const [projectId, count] of byProject) {
      log(`  ${projectId}  ${String(count)}`);
    }

    if (!commit) {
      log("\nnothing enqueued — pass --run to do it");
      return;
    }

    // The worker's connection, because this enqueues the worker's jobs — and
    // pg-boss needs a session-mode URL, which is exactly what that role is.
    const url = process.env["DATABASE_URL_WORKER"];
    if (url === undefined || url === "") throw new Error("DATABASE_URL_WORKER is not set");
    const boss = createQueue({ connectionString: url });
    await boss.start();
    try {
      await ensureQueues(boss);
      for (const row of wanted) {
        const identity = thumbnailIdentity(row);
        await enqueueStage(boss, {
          projectId: row.projectId,
          assetId: row.id,
          stage: "thumbnail",
          inputHash: identity.inputHash,
          attempt: 1,
        });
      }
      log(`\nenqueued ${String(wanted.length)} thumbnail job(s) — the worker does the rest`);
    } finally {
      await boss.stop();
    }
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(
    `\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
