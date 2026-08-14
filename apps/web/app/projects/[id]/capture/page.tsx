import { notFound, redirect } from "next/navigation";

import { guardProject } from "../../../../src/server/auth.js";
import { loadWalkthroughView } from "../../../../src/server/capture.js";

/**
 * The bare capture URL always resumes.
 *
 * There is no wizard state to lose because there is no wizard state: what has
 * been captured is what has asset rows, so "where was I" is a query rather
 * than something the browser had to remember. Someone can close the tab
 * halfway through the photographs and pick up on another device a week later.
 */
export default async function CaptureEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await guardProject(id, `/projects/${id}/capture`);

  const walkthrough = await loadWalkthroughView(id);
  if (walkthrough === null) notFound();

  // Already started: the film is out of the customer's hands and into the
  // pipeline's, so send them to where they can watch it happen.
  if (walkthrough.status !== "capturing") redirect(`/projects/${id}`);

  const next =
    walkthrough.steps.find((s) => s.required && s.asset === null) ?? walkthrough.steps[0];
  if (next === undefined) notFound();

  redirect(`/projects/${id}/capture/${next.id}`);
}
