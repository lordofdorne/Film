/**
 * Applies every migration in packages/db/migrations, in filename order, once.
 *
 *   pnpm db:migrate
 *
 * There was one migration and `psql -f` was enough. There are two now, and a
 * command that re-runs every file on every deploy is a command someone will
 * eventually run against production. So the applied set is recorded, each file
 * runs inside a transaction, and the run stops at the first failure with the
 * later migrations untouched.
 *
 * The connection must be direct, not pooled — migrations take session-level
 * locks. @film/db refuses a pooled URL for this role rather than letting it
 * fail somewhere less obvious.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPool } from "@film/db";

const DIR = fileURLToPath(new URL("../packages/db/migrations", import.meta.url));

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const main = async (): Promise<void> => {
  const pool = createPool("migrations");
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    /**
     * Adopt a database that was migrated before this script existed.
     *
     * The first migration was applied by hand with psql, so a working
     * development database has the tables but no record of them. Re-running
     * 0000 against it would fail on the existing types; refusing to run at all
     * would be worse. Detecting the table it creates is the least surprising
     * way through, and it only ever fires once.
     */
    const adopted = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('public.stage_executions') IS NOT NULL AS exists`,
    );
    if (adopted.rows[0]?.exists === true) {
      await client.query(
        `INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`,
        ["0000_initial_pipeline_schema.sql"],
      );
    }

    const applied = new Set(
      (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map(
        (r) => r.name,
      ),
    );

    const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      log(`up to date — ${String(applied.size)} migration(s) applied`);
      return;
    }

    for (const file of pending) {
      const sql = await readFile(join(DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        log(`applied ${file}`);
      } catch (error: unknown) {
        await client.query("ROLLBACK");
        throw new Error(
          `${file} failed and was rolled back; later migrations were not attempted\n` +
            `  ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(
    `\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
