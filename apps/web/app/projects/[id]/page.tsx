import { notFound } from "next/navigation";
import { guardProject } from "../../../src/server/auth.js";
import { loadWalkthroughView } from "../../../src/server/capture.js";
import { loadDelivery, loadProjectForPreview } from "../../../src/server/project.js";
import { DeliveryPanel } from "./DeliveryPanel.js";
import { Hub } from "./Hub.js";
import { PreviewClient } from "./PreviewClient.js";
import { WorkingNote } from "./WorkingNote.js";

/**
 * One URL for a film, whatever state it is in.
 *
 * While the project is capturing this is the hub — the home of the flow,
 * where somebody lands after choosing and returns after every capture. Once
 * the film has been handed over it is the preview and approval page. In
 * between — handed over, not yet composed — it says so and keeps checking,
 * because the worst page for that moment is a 404 with the customer's whole
 * film behind it.
 *
 * Server component: every read happens here, through Drizzle. Asset URLs are
 * resolved just before render and handed down as props. The client never
 * learns a storage key, never holds a credential, and never touches Postgres.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  /**
   * Before anything is read, let alone rendered. This page approves films and
   * links to the download, so it is the surface where "anyone with the URL"
   * mattered most. Signed out sends them to get a link; somebody else's film
   * is a 404, because "not yours" confirms there is something there.
   */
  await guardProject(id, `/projects/${id}`);

  const walkthrough = await loadWalkthroughView(id);
  if (walkthrough === null) notFound();

  if (walkthrough.status === "capturing") {
    return <Hub walkthrough={walkthrough} />;
  }

  const loaded = await loadProjectForPreview(id);
  if (loaded === null) {
    // Handed to the pipeline, nothing composed yet. The page between capture
    // and preview that used to be a 404.
    return <WorkingNote />;
  }

  /**
   * The approver is the signed-in owner where there is one; on an
   * unconfigured server it falls back to the project's owner row, which is
   * also who guardProject let through.
   */
  const approverId = loaded.summary.ownerId;

  const delivery = (await loadDelivery(id)) ?? { kind: "unapproved" as const };

  return (
    <PreviewClient
      summary={loaded.summary}
      props={loaded.props}
      approverId={approverId}
      delivery={<DeliveryPanel projectId={id} initial={delivery} />}
    />
  );
}
