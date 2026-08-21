import "server-only";

import { headers } from "next/headers";

/**
 * Where this deployment lives, for the links in emails to point back at.
 *
 * A plain module rather than an export of a "use server" file: everything
 * exported from one of those becomes a callable endpoint, and this is a
 * helper, not an action.
 */
export const origin = async (): Promise<string> => {
  const configured = process.env["NEXT_PUBLIC_SITE_URL"] ?? "";
  if (configured !== "") return configured.replace(/\/$/, "");
  const head = await headers();
  const host = head.get("host") ?? "localhost:3200";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
};

/**
 * A path on this site, never an absolute URL somebody handed us.
 *
 * An open redirect on the end of a sign-in link is how a login page becomes a
 * phishing page, and every one of these flows takes a `next` from a query
 * string or a form field.
 */
export const safeNext = (next: string | null | undefined): string | null =>
  typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : null;
