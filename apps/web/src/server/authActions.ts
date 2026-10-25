"use server";

import { redirect } from "next/navigation";

import { authConfigured, supabase } from "./auth.js";

/**
 * Signing out. Signing in and making an account are in passwordActions — an
 * email and a password are the only way in; there is no emailed link.
 */
export const signOut = async (): Promise<void> => {
  if (authConfigured()) {
    const client = await supabase();
    await client.auth.signOut();
  }
  redirect("/");
};
