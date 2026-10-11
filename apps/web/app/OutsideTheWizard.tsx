"use client";

import { usePathname } from "next/navigation";

/**
 * Renders its children everywhere except inside the capture wizard.
 *
 * A step is a full-screen moment — somebody is holding a phone up to a person
 * they love — and the site header is chrome it does not need: the wizard's own
 * bar has the way out, the overview, and where they are.
 */
export const OutsideTheWizard = ({ children }: { readonly children: React.ReactNode }) => {
  const path = usePathname();
  return /^\/projects\/[^/]+\/(step\/|chapter\/|continue$)/.test(path) ? null : <>{children}</>;
};
