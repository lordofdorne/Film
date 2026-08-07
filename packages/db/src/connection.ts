import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { z } from "zod";
import * as schema from "./schema/tables.js";

export type Db = NodePgDatabase<typeof schema>;

/**
 * Three connections, not one.
 *
 * Supabase's pooler runs in transaction mode. That is correct for serverless
 * request handlers and wrong for a long-lived queue consumer: pg-boss holds
 * sessions and uses LISTEN/NOTIFY, neither of which survives a transaction
 * pooler. The failure is not a clean error — it is jobs that silently never
 * arrive, which is close to undiagnosable in production.
 *
 * So the rule is enforced at startup rather than written in a README.
 */
export const ConnectionRole = z.enum(["web", "worker", "migrations"]);
export type ConnectionRole = z.infer<typeof ConnectionRole>;

/** Supavisor / PgBouncer transaction-mode pooler. */
const TRANSACTION_POOLER_PORT = 6543;

const ENV_VAR: Record<ConnectionRole, string> = {
  web: "DATABASE_URL_WEB",
  worker: "DATABASE_URL_WORKER",
  migrations: "DATABASE_URL_MIGRATIONS",
};

export class ConnectionRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionRoleError";
  }
}

/**
 * Rejects a connection string that cannot do the job asked of it.
 *
 * Exported and pure so it is unit-testable without a database — the whole
 * point is that this fires before anything connects.
 */
export const assertUrlSuitableFor = (role: ConnectionRole, url: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConnectionRoleError(`${ENV_VAR[role]} is not a valid connection URL`);
  }

  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new ConnectionRoleError(
      `${ENV_VAR[role]} must be a postgres:// URL, got "${parsed.protocol}//"`,
    );
  }

  const port = parsed.port === "" ? 5432 : Number(parsed.port);
  const pooled =
    port === TRANSACTION_POOLER_PORT ||
    parsed.searchParams.get("pgbouncer") === "true" ||
    parsed.hostname.includes("pooler.supabase.com") && port === TRANSACTION_POOLER_PORT;

  if ((role === "worker" || role === "migrations") && pooled) {
    throw new ConnectionRoleError(
      `${ENV_VAR[role]} points at a transaction-mode pooler (port ${String(port)}). ` +
        (role === "worker"
          ? "pg-boss needs session state and LISTEN/NOTIFY; through a transaction pooler " +
            "jobs are silently never delivered. Use the direct connection or session mode (5432)."
          : "Migrations need session-level locks. Use the direct connection (5432)."),
    );
  }
};

export type PoolOptions = {
  readonly url?: string | undefined;
  readonly max?: number | undefined;
  readonly applicationName?: string | undefined;
};

/**
 * Sensible pool ceilings per role. A render worker holding twenty idle
 * connections while it spends six minutes inside Chrome is pure waste, and at
 * scale it is how you exhaust Postgres' connection limit.
 */
const DEFAULT_MAX: Record<ConnectionRole, number> = {
  web: 10,
  worker: 4,
  migrations: 1,
};

export const createPool = (role: ConnectionRole, options: PoolOptions = {}): pg.Pool => {
  const varName = ENV_VAR[role];
  const url = options.url ?? process.env[varName];
  if (url === undefined || url === "") {
    throw new ConnectionRoleError(`${varName} is not set`);
  }
  assertUrlSuitableFor(role, url);

  return new pg.Pool({
    connectionString: url,
    max: options.max ?? DEFAULT_MAX[role],
    application_name: options.applicationName ?? `life-advice-${role}`,
    // A worker that cannot get a connection should fail its stage and be
    // retried, not block a container forever.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: role === "web" ? 30_000 : 10_000,
  });
};

export const createDb = (role: ConnectionRole, options: PoolOptions = {}): {
  db: Db;
  pool: pg.Pool;
} => {
  const pool = createPool(role, options);
  return { db: drizzle(pool, { schema }), pool };
};

export { schema };
