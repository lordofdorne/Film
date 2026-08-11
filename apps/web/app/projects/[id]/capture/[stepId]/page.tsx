import { notFound, redirect } from "next/navigation";

import { loadWalkthroughView } from "../../../../../src/server/capture.js";
import { StepClient } from "./StepClient.js";

/**
 * Server component: the template is resolved here and handed down as data.
 *
 * The client gets a step — an ask, some coaching, what it accepts, and what is
 * already captured for it. It never sees the template, never learns a storage
 * key it was not given for one upload, and contains no string that belongs to
 * one kind of film.
 */
export default async function CaptureStepPage({
  params,
}: {
  params: Promise<{ id: string; stepId: string }>;
}) {
  const { id, stepId } = await params;
  const walkthrough = await loadWalkthroughView(id);
  if (walkthrough === null) notFound();
  if (walkthrough.status !== "capturing") redirect(`/projects/${id}`);

  const index = walkthrough.steps.findIndex((s) => s.id === stepId);
  if (index === -1) notFound();

  // Non-null: findIndex just found it.
  const step = walkthrough.steps[index]!;
  const previous = walkthrough.steps[index - 1];
  const next = walkthrough.steps[index + 1];

  return (
    <StepClient
      projectId={id}
      step={step}
      previousId={previous?.id ?? null}
      nextId={next?.id ?? null}
      totalSteps={walkthrough.steps.length}
      firstOfChapter={previous === undefined || previous.chapterId !== step.chapterId}
    />
  );
}
