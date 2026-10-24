import { notFound, redirect } from "next/navigation";

import { guardedWalkthrough } from "../../../../src/server/capture.js";
import { frameMapOf } from "../../../../src/server/wizard.js";
import { WizardFrame } from "../WizardFrame.js";

/**
 * The wizard's frame, held still while its screens change.
 *
 * Every step and chapter intro lives under this layout, so moving between them
 * replaces only the middle of the screen: the bar, the progress and the All
 * steps sheet stay mounted. Part 7 drew the frame from each page and rebuilt
 * all of it on every tap. Block 2 of Phase 8 also hangs the camera here, which
 * is what lets it stay on between questions.
 *
 * The pages keep their own guard. A layout's checks do not protect the pages
 * inside it — they render in parallel — and the guard and the walk-through
 * are cached per request, so asking twice costs nothing.
 */
export default async function WizardLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const view = await guardedWalkthrough(id, `/projects/${id}`);
  if (view === null) notFound();
  if (view.status !== "capturing") redirect(`/projects/${id}`);

  return (
    <WizardFrame projectId={id} map={frameMapOf(id, view.steps)}>
      {children}
    </WizardFrame>
  );
}
