import { notFound, redirect } from "next/navigation";

import { guardProject } from "../../../../../../src/server/auth.js";
import { loadWalkthroughView, stepWithMedia } from "../../../../../../src/server/capture.js";
import { nextHref } from "../../../../../../src/server/wizard.js";
import { DetailStepClient } from "./DetailStepClient.js";
import { StepClient } from "./StepClient.js";

/**
 * One step of the wizard: the ask, the coaching, the camera or the input, and
 * a way forward.
 *
 * Where "forward" goes is worked out here, from the rows, and handed down as
 * a plain href — so the client never decides the order, and finishing a step
 * on one device and opening the film on another lands in the same place.
 * Finishing and skipping lead to the same stop, because `nextStop` never
 * returns the step being left.
 */
export default async function StepPage({
  params,
}: {
  params: Promise<{ id: string; stepId: string }>;
}) {
  const { id, stepId } = await params;
  const guard = await guardProject(id, `/projects/${id}/step/${stepId}`);
  // Handed over without an account: the film's own page asks for one.
  if (guard.needsAccount) redirect(`/projects/${id}`);

  const walkthrough = await loadWalkthroughView(id);
  if (walkthrough === null) notFound();

  // Handed over already: every step is read-only history now, and the hub —
  // by then the preview — is the only sensible place to be.
  if (walkthrough.status !== "capturing") redirect(`/projects/${id}`);

  /**
   * URLs for this step and no other.
   *
   * This page shows one take. It used to be handed a signed URL for every
   * asset in the film — eighteen bearer credentials for whole interviews, of
   * which it drew one — because loading the walk-through and signing it were
   * the same act. They are two acts now, and this is the one that asks.
   */
  const step = await stepWithMedia(walkthrough, stepId);
  if (step === null) notFound();

  const next = nextHref(id, walkthrough.steps, step.id);

  // The frame around it is the layout's: this page is only the middle.
  return step.kind === "detail" ? (
    <DetailStepClient key={step.id} projectId={id} step={step} nextHref={next} />
  ) : (
    <StepClient key={step.id} projectId={id} step={step} nextHref={next} />
  );
}
