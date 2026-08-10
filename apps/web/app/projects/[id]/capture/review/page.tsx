import { notFound, redirect } from "next/navigation";

import { loadWalkthrough } from "../../../../../src/server/capture.js";
import { ReviewClient } from "./ReviewClient.js";

export default async function CaptureReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const walkthrough = await loadWalkthrough(id);
  if (walkthrough === null) notFound();
  if (walkthrough.status !== "capturing") redirect(`/projects/${id}`);

  return (
    <ReviewClient projectId={id} steps={walkthrough.steps} missing={walkthrough.missing} />
  );
}
