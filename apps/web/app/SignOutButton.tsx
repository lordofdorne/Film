"use client";

import { useTransition } from "react";

import { signOut } from "../src/server/authActions.js";
import { Button } from "../src/ui/index.js";

export const SignOutButton = ({ block = false }: { readonly block?: boolean }) => {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      block={block}
      pending={pending}
      onClick={() => { startTransition(async () => { await signOut(); }); }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
};
