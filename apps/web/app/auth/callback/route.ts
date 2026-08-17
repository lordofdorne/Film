import { NextResponse } from "next/server";

import { adoptFilms } from "@film/db";

import { authConfigured, currentUser, dbForAuth, supabase } from "../../../src/server/auth.js";

/**
 * Where the link in the email lands.
 *
 * Exchanges the one-time code for a session, then sends them on. The exchange
 * has to happen server-side in a handler that can write cookies, which is why
 * this is a route rather than a page.
 *
 * `currentUser()` is called before redirecting, on purpose: that is what links
 * the verified identity to the application's user row, and doing it here means
 * somebody's films are already theirs by the time the next page renders,
 * rather than on whichever request happens to touch it first.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");

  // A path on this site, never an absolute URL from the query string: an open
  // redirect on the end of a sign-in link turns a login page into a phishing
  // page.
  const destination =
    next !== null && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!authConfigured() || code === null) {
    return NextResponse.redirect(new URL("/signin?error=link", url.origin));
  }

  const client = await supabase();

  /**
   * Who was holding this browser BEFORE the exchange — possibly the anonymous
   * identity that pressed Start and made a film. Read now, because the
   * exchange replaces the session, and read with getUser() so it is a claim
   * the auth server has verified rather than whatever was in the cookie.
   *
   * This is the deliberate half of the merge: the browser demonstrably holds
   * the anonymous session, and clicking the link demonstrably proves the
   * address. Only a request that shows both moves any films.
   */
  const before = await client.auth.getUser();
  const anonymousAuthId =
    before.error === null && before.data.user !== null && before.data.user.is_anonymous === true
      ? before.data.user.id
      : null;

  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error !== null) {
    // Expired, already used, or opened in a different browser from the one that
    // asked for it. All three are the same thing to the person holding it, and
    // all three are fixed by asking for another.
    return NextResponse.redirect(new URL("/signin?error=expired", url.origin));
  }

  const user = await currentUser();
  if (user !== null && anonymousAuthId !== null && user.authId !== anonymousAuthId) {
    // The films made before the address was proved follow the person.
    // adoptFilms itself refuses any source row that has an email, so a
    // confused or hostile caller cannot drain a real account through this.
    await adoptFilms(dbForAuth(), { fromAuthId: anonymousAuthId, toUserId: user.id });
  }

  return NextResponse.redirect(new URL(destination, url.origin));
}
