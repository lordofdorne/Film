import { NextResponse } from "next/server";

import {
  anonymousHolder,
  authConfigured,
  carryFilmsOver,
  currentUser,
  supabase,
} from "../../../src/server/auth.js";

/**
 * Where a password-reset link lands, and a separate door on purpose.
 *
 * Every proving link Supabase sends — the magic link, the address
 * confirmation, this — comes back as `?code=` on whatever redirect was asked
 * for, with nothing in the URL to say which kind it was. So the way to know
 * somebody arrived here to choose a new password is to have sent them to a
 * different address in the first place.
 *
 * The alternative was a flag on /auth/callback, which would have meant the one
 * route that adopts an anonymous browser's films growing a second mode. That
 * route is subtle and works; this one is four lines and cannot break it.
 *
 * What this is not: a lesser session. Clicking a link in a mailbox is exactly
 * the proof a magic link gives, so the person is signed in when they get here
 * and could simply navigate away. The redirect to the form is a courtesy — it
 * puts them where they were trying to go — not a boundary.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!authConfigured() || code === null) {
    return NextResponse.redirect(new URL("/signin?error=link", url.origin));
  }

  const client = await supabase();
  const anonymousAuthId = await anonymousHolder(client);

  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error !== null) {
    return NextResponse.redirect(new URL("/signin?error=expired", url.origin));
  }

  // Somebody can be making a film anonymously in this browser and reset the
  // password of an older account in the same breath. Rare, and the films
  // should still follow them.
  await carryFilmsOver(anonymousAuthId, await currentUser());

  return NextResponse.redirect(new URL("/account/password?from=reset", url.origin));
}
