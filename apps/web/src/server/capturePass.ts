import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Proof that this browser is the one that started a film.
 *
 * Sign-in is a magic link, which means there is a gap: somebody fills in the
 * form at /start, the project is created and the link is sent — and they are
 * still, at that instant, signed out. Guarding the walk-through on the session
 * alone put them on a sign-in page one click into the product, waiting on an
 * email, holding a phone, with an elderly relative sitting opposite. That is
 * the moment people give up.
 *
 * So the browser that created a project gets a pass for it: httpOnly, signed
 * here, and worth nothing anywhere else. It is not a session and it is not an
 * identity — it says one thing, "this browser started this film", which is
 * exactly the claim the walk-through needs and no more. Clicking the link in
 * the email still produces a real session, still adopts the project, and is
 * still what lets them continue on another device.
 *
 * Deliberately narrower than what it replaces: before auth, ANY browser
 * holding the URL could add to a project, approve its film and download it. A
 * pass is confined to one browser and to projects it started itself.
 */

const COOKIE = "film_capture_pass";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** More than anyone starts before signing in; a cookie is not a database. */
const MAX_PASSES = 10;

const secret = (): string => {
  const holder = globalThis as { __capturePassSecret?: string };
  holder.__capturePassSecret ??=
    process.env["CAPTURE_PASS_SECRET"] ?? randomBytes(32).toString("hex");
  return holder.__capturePassSecret;
};

type Pass = { readonly p: string; readonly e: number };

const sign = (body: string): string =>
  createHmac("sha256", secret()).update(body).digest("base64url");

/** Constant time, because this is the comparison that decides access. */
const matches = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

const encode = (passes: readonly Pass[]): string => {
  const body = Buffer.from(JSON.stringify(passes)).toString("base64url");
  return `${body}.${sign(body)}`;
};

const decode = (raw: string | undefined): Pass[] => {
  if (raw === undefined) return [];
  const [body, signature] = raw.split(".");
  if (body === undefined || signature === undefined) return [];
  if (!matches(sign(body), signature)) return [];
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(
      (p): p is Pass =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as Pass).p === "string" &&
        typeof (p as Pass).e === "number" &&
        (p as Pass).e > now,
    );
  } catch {
    return [];
  }
};

/**
 * Hand this browser a pass for a project it just created.
 *
 * Only ever called immediately after creating one. Cookies can only be written
 * from an action or a route handler, which is where this belongs anyway — a
 * page that merely renders the walk-through has no business granting access to
 * it.
 */
export const grantCapturePass = async (projectId: string): Promise<void> => {
  const store = await cookies();
  const existing = decode(store.get(COOKIE)?.value);
  const passes = [{ p: projectId, e: Date.now() + TTL_MS }, ...existing.filter((x) => x.p !== projectId)]
    .slice(0, MAX_PASSES);

  store.set(COOKIE, encode(passes), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  });
};

export const holdsCapturePass = async (projectId: string): Promise<boolean> => {
  const store = await cookies();
  return decode(store.get(COOKIE)?.value).some((pass) => pass.p === projectId);
};
