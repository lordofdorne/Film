import "server-only";

import { createDb, type Db } from "@film/db";

/**
 * The web app's one connection pool.
 *
 * Every server module used to keep its own (`auth`, `capture`, `project`,
 * `actions`, the download route): five pools of up to ten connections each,
 * so one instance could hold fifty against Postgres, and each pool opened its
 * own connections cold — a page that touched three modules paid three
 * handshakes after any idle half-minute. Against a hosted database that is
 * tens of milliseconds a time, on the taps that were already the slow ones.
 *
 * Held on globalThis, not in a module constant, for the reason the upload
 * secret is (see `uploadSecret` in capture.ts): Next compiles server actions,
 * route handlers and pages as separate module graphs, so a module-level pool
 * is still one per graph. In development it is also what stops every hot
 * reload leaking a fresh pool.
 */
export const webDb = (): Db => {
  const holder = globalThis as { __filmWebDb?: Db };
  holder.__filmWebDb ??= createDb("web").db;
  return holder.__filmWebDb;
};
