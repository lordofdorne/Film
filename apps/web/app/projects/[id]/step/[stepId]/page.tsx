import { notFound, redirect } from "next/navigation";

import { guardProject } from "../../../../../src/server/auth.js";
import { loadWalkthroughView, stepWithMedia } from "../../../../../src/server/capture.js";
import { DetailStepClient } from "./DetailStepClient.js";
import { StepClient } from "./StepClient.js";

/**
 * One step, opened from the hub: a detour, not a destination.
 *
 * Give us the thing — a typed answer, a take, a photograph — and go back.
 * There is no Next and no counter, because the hub is the map and nobody is
 * ever mid-sequence.
 */
export default async function StepPage({
  params,
}: {
  params: Promise<{ id: string; stepId: string }>;
}) {
  const { id, stepId } = await params;
  await guardProject(id, `/projects/${id}/step/${stepId}`);

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

  if (step.kind === "detail") {
    return <DetailStepClient projectId={id} step={step} />;
  }
  return <StepClient projectId={id} step={step} />;
}
