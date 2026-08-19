import "server-only";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adoptFilms,
  createDb,
  linkIdentity,
  ownsProject,
  type AppUser,
  type Db,
} from "@film/db";

/**
 * Who is asking, and may they.
 *
 * Supabase Auth issues the session; this reads it, maps it to the application's
 * own user row, and answers the one question every protected surface has to ask
 * before it renders anything. The mapping and the ownership rule live in
 * @film/db where they are tested against a real database — what is here is the
 * part that is genuinely about being a web app: cookies.
 */

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

/**
 * Whether anybody can sign in at all.
 *
 * False when Supabase is not configured, which is how the offline path stays
 * first-class: `pnpm intake`, the worker and the whole fixture pipeline still
 * run with nothing but Postgres and a directory of files, exactly as the
 * project has always insisted.
 *
 * It is a loud state rather than a silent one — every page says so in a banner
 * — because "auth quietly turned itself off" is the worst possible way for this
 * flag to be wrong.
 */
export const authConfigured = (): boolean =>
  (process.env[URL_VAR] ?? "") !== "" && (process.env[KEY_VAR] ?? "") !== "";

let cached: Db | undefined;
const db = (): Db => {
  cached ??= createDb("web").db;
  return cached;
};

/** The same connection, for the one route that adopts films after sign-in. */
export const dbForAuth = (): Db => db();

/**
 * A Supabase client bound to this request's cookies.
 *
 * The cookie writes are wrapped because a Server Component may not set them.
 * That is not an error to swallow blindly — it is the documented shape of the
 * SSR helper: the middleware and the callback route refresh the session, and a
 * page that merely reads one has nothing to write back.
 */
export const supabase = async (): Promise<SupabaseClient> => {
  const store = await cookies();
  return createServerClient(process.env[URL_VAR] ?? "", process.env[KEY_VAR] ?? "", {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // A Server Component cannot set cookies. Refreshing happens in the
          // callback route and the middleware, both of which can.
        }
      },
    },
  });
};

/**
 * The signed-in user, as this application knows them, or null.
 *
 * `getUser()` rather than `getSession()`: getSession trusts whatever is in the
 * cookie, and the cookie came from the browser. getUser verifies the token with
 * the auth server, which is the difference between an identity and a claim.
 */
export const currentUser = async (): Promise<AppUser | null> => {
  if (!authConfigured()) return null;

  const client = await supabase();
  const { data, error } = await client.auth.getUser();
  if (error !== null || data.user === null) return null;

  // An anonymous identity has no email and is still an identity: the browser
  // that pressed Start owns its film through exactly this path.
  return linkIdentity(db(), { authId: data.user.id, email: data.user.email ?? null });
};

/**
 * The signed-in user, creating an anonymous one if nobody is.
 *
 * How a project is owned from birth: the first press of Start signs the
 * browser in with `signInAnonymously()` — a real identity with no email — so
 * every ownership check works unchanged and there is no gap for a pass or a
 * placeholder to paper over. When the person later proves an address, the
 * callback route moves these films to the verified identity.
 *
 * Only callable where cookies can be written: a server action or a route
 * handler. A page render must use currentUser instead.
 */
export const ensureUser = async (): Promise<AppUser | null> => {
  if (!authConfigured()) return null;

  const existing = await currentUser();
  if (existing !== null) return existing;

  const client = await supabase();
  const { data, error } = await client.auth.signInAnonymously();
  if (error !== null || data.user === null) {
    // Almost always anonymous sign-in disabled on the Supabase project — a
    // configuration state, and one worth naming precisely at the surface.
    throw new Error(
      `could not create a visitor session: ${error?.message ?? "no user returned"}. ` +
        "Anonymous sign-ins must be enabled on the Supabase project.",
    );
  }
  return linkIdentity(db(), { authId: data.user.id, email: data.user.email ?? null });
};

/**
 * The session as the auth provider describes it, before it is mapped to a row.
 *
 * `currentUser` answers "who is this, to the application". This answers "what
 * state is their identity in", which is a different question and only two
 * surfaces ask it: the offer to set a password, and the decision whether
 * sending a magic link would collide with a confirmation already in flight.
 *
 * `pendingEmail` is the one that matters. Setting a password on an anonymous
 * session gives Supabase an address it will not attach until somebody proves
 * they can read that mailbox — it sits in `new_email` meanwhile, and the
 * application's own row still says null, correctly. Anything that would send
 * a second email to that address has to know it is there.
 */
export type SessionIdentity = {
  readonly authId: string;
  /** Proved, and therefore ours to use. */
  readonly email: string | null;
  /** Given, not yet proved. Never treated as an address we may rely on. */
  readonly pendingEmail: string | null;
  readonly anonymous: boolean;
};

export const sessionIdentity = async (): Promise<SessionIdentity | null> => {
  if (!authConfigured()) return null;
  const client = await supabase();
  const { data, error } = await client.auth.getUser();
  if (error !== null || data.user === null) return null;

  const email = data.user.email ?? "";
  const pending = data.user.new_email ?? "";
  return {
    authId: data.user.id,
    email: email === "" ? null : email,
    pendingEmail: pending === "" ? null : pending,
    anonymous: data.user.is_anonymous === true,
  };
};

/**
 * The films made before an address was proved follow the person.
 *
 * Shared by every route a proving link can land on — the magic link and the
 * password-recovery link both arrive as an exchanged code, and both may be
 * clicked in a browser that has been making a film anonymously all along.
 *
 * The caller reads `before` from the session it is holding, ahead of the
 * exchange that replaces it. `adoptFilms` itself refuses any source row that
 * has an address, so a confused or hostile caller cannot drain a real account
 * through this.
 */
export const anonymousHolder = async (client: SupabaseClient): Promise<string | null> => {
  const before = await client.auth.getUser();
  return before.error === null &&
    before.data.user !== null &&
    before.data.user.is_anonymous === true
    ? before.data.user.id
    : null;
};

export const carryFilmsOver = async (
  fromAuthId: string | null,
  user: AppUser | null,
): Promise<void> => {
  // Same identity on both sides is the ordinary case now: confirming an
  // address on an anonymous session keeps its auth id, so there is nothing to
  // move and moving would be wrong.
  if (fromAuthId === null || user === null || user.authId === fromAuthId) return;
  await adoptFilms(db(), { fromAuthId, toUserId: user.id });
};

export type Access =
  | { readonly allowed: true; readonly user: AppUser | null }
  | { readonly allowed: false; readonly reason: "signed-out" | "not-yours" };

/**
 * May the person asking see this project?
 *
 * The two refusals are deliberately different. "Signed out" is answerable — go
 * and click the link in your email. "Not yours" is not, and it must not leak
 * whether the project exists: somebody probing project ids should learn nothing
 * from the difference between a film that is not theirs and one that is not
 * there, so callers render both as 404.
 */
export const accessToProject = async (projectId: string): Promise<Access> => {
  // Nobody to check against, and nothing to check. Development only, and every
  // page says so.
  if (!authConfigured()) return { allowed: true, user: null };

  const user = await currentUser();
  if (user !== null && (await ownsProject(db(), user.id, projectId))) {
    return { allowed: true, user };
  }

  return { allowed: false, reason: user === null ? "signed-out" : "not-yours" };
};

/**
 * The same check, for a page: sign them in, or show them a 404.
 *
 * A film that is not yours is Not Found rather than Forbidden. "You may not
 * see this" confirms there is something to see, and somebody working through
 * project ids should learn nothing from the difference between a film that is
 * not theirs and one that does not exist.
 */
export const guardProject = async (
  projectId: string,
  backTo: string,
): Promise<AppUser | null> => {
  const access = await accessToProject(projectId);
  if (access.allowed) return access.user;
  if (access.reason === "signed-out") {
    redirect(`/signin?next=${encodeURIComponent(backTo)}`);
  }
  notFound();
};
