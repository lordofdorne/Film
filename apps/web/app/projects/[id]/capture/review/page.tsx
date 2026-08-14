import { notFound, redirect } from "next/navigation";

import { guardProject } from "../../../../../src/server/auth.js";
import { loadWalkthroughView } from "../../../../../src/server/capture.js";
import { ReviewClient } from "./ReviewClient.js";

export default async function CaptureReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await guardProject(id, `/projects/${id}/capture/review`);

  const walkthrough = await loadWalkthroughView(id);
  if (walkthrough === null) notFound();
  if (walkthrough.status !== "capturing") redirect(`/projects/${id}`);

  return (
    <ReviewClient projectId={id} steps={walkthrough.steps} missing={walkthrough.missing} />
  );
}
