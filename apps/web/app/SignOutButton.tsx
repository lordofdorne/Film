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
      style={styles.button}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
};

const styles = {
  button: {
    border: "none",
    background: "none",
    padding: 0,
    font: "inherit",
    color: "#888",
    textDecoration: "underline",
    cursor: "pointer",
  },
} as const;
