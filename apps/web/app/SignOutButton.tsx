"use client";

import { useTransition } from "react";

import { signOut } from "../src/server/authActions.js";

export const SignOutButton = () => {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => { startTransition(async () => { await signOut(); }); }}
      className="linklike"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
};

