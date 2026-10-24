import { NextResponse } from "next/server";

import {
  anonymousHolder,
  authConfigured,
  carryFilmsOver,
  currentUser,
  supabase,
} from "../../../src/server/auth.js";

/**
 * Where a password-reset link lands — the one email this product sends.
 *
 * Supabase brings it back as `?code=`; exchanging it signs the person in, and
 * any film this browser made anonymously comes with them. Then the form to
 * choose a new password. What this is not: a lesser session. Clicking a link
 * in a mailbox proves the mailbox, so the person is signed in when they get
 * here and could simply navigate away. The redirect to the form is a courtesy
 * — it puts them where they were trying to go — not a boundary.
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
