import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../src/index.js";
import * as schema from "../src/schema/tables.js";

/**
 * Every table in `public` denies by default.
 *
 * A boundary test rather than a migration, because the risk is not the tables
 * that exist today — 0003 handled those. It is the fourteenth table, added in
 * six months by somebody who does not know that Supabase publishes this schema
 * over HTTP to a key that ships in the browser bundle.
 *
 * The failure this prevents is silent and total: a new table with RLS off is
 * readable by anyone who views source, and nothing in the application would
 * behave any differently.
 */

const DB_URL = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres:film@localhost:55432/film";

let pool: pg.Pool;
let db: Db;
let available = false;

beforeAll(async () => {
  try {
    pool = new pg.Pool({ connectionString: DB_URL, max: 2 });
    db = drizzle(pool, { schema });
    await pool.query("select 1");
    available = true;
  } catch (error: unknown) {
    process.stderr.write(`test database unavailable: ${String(error)}\n`);
    available = false;
  }
}, 60_000);

afterAll(async () => {
  await pool?.end();
});

describe("row level security", () => {
  it("is enabled on every table in public", async () => {
    if (!available) throw new Error("Postgres unavailable — `pnpm db:up`");

    const result = await db.execute(sql`
      select tablename
      from pg_tables
      where schemaname = 'public' and rowsecurity = false
      order by tablename
    `);
    const unprotected = result.rows.map((r) => String(r["tablename"]));

    expect(
      unprotected,
      `these tables are exposed if the Data API is ever enabled; add them to a ` +
        `migration with ENABLE ROW LEVEL SECURITY`,
    ).toEqual([]);
  });

  /**
   * A policy here would be a second copy of `ownsProject` in a second language,
   * free to disagree with the first. Authorisation is the application's, and
   * this schema is meant to be reachable by nothing but the owner connection.
   */
  it("grants nothing back through a policy", async () => {
    if (!available) throw new Error("Postgres unavailable — `pnpm db:up`");

    const result = await db.execute(sql`
      select schemaname || '.' || tablename || ':' || policyname as policy
      from pg_policies
      where schemaname = 'public'
      order by 1
    `);
    expect(result.rows.map((r) => String(r["policy"]))).toEqual([]);
  });
});
