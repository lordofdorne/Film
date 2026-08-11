"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authConfigured, supabase } from "./auth.js";

/**
 * Sign-in, such as it is: type an address, get a link, click it.
 *
 * Deliberately server-side. The one-time-password flow stores a code verifier
 * that the callback route has to present when it exchanges the code, and
 * keeping both halves on the server means the verifier lives in an httpOnly
 * cookie rather than in the page.
 */

export type SendResult =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false; readonly error: string };

/** Where this deployment lives, for the link in the email to point back at. */
const origin = async (): Promise<string> => {
  const configured = process.env["NEXT_PUBLIC_SITE_URL"] ?? "";
  if (configured !== "") return configured.replace(/\/$/, "");
  const head = await headers();
  const host = head.get("host") ?? "localhost:3200";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
};

export const sendMagicLink = async (rawEmail: string, next?: string): Promise<SendResult> => {
  if (!authConfigured()) {
    return { ok: false, error: "Sign-in is not configured on this server." };
  }

  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "That does not look like an email address." };
  }

  const client = await supabase();
  const target = new URL("/auth/callback", await origin());
  // Only ever a path, never a full URL somebody handed us: an open redirect on
  // the end of a sign-in link is how a login page becomes a phishing page.
  if (next !== undefined && next.startsWith("/") && !next.startsWith("//")) {
    target.searchParams.set("next", next);
  }

  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: target.toString() },
  });

  /**
   * Errors are reported, but "no such account" is not one of them — Supabase
   * creates the user on first link, so there is nothing to disclose. If that
   * ever changes, this must still not tell a stranger which addresses have
   * accounts.
   */
  if (error !== null) return { ok: false, error: "Could not send the link. Try again in a moment." };
  return { ok: true, email };
};

export const signOut = async (): Promise<void> => {
  if (authConfigured()) {
    const client = await supabase();
    await client.auth.signOut();
  }
  redirect("/");
};
