import { notFound, redirect } from "next/navigation";

import { guardProject } from "../../../../../src/server/auth.js";
import { loadWalkthroughView } from "../../../../../src/server/capture.js";
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

  const step = walkthrough.steps.find((s) => s.id === stepId);
  if (step === undefined) notFound();

  if (step.kind === "detail") {
    return <DetailStepClient projectId={id} step={step} />;
  }
  return <StepClient projectId={id} step={step} />;
}
