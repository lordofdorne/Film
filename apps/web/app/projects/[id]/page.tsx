import { notFound } from "next/navigation";
import { guardProject } from "../../../src/server/auth.js";
import { loadDelivery, loadProjectForPreview } from "../../../src/server/project.js";
import { DeliveryPanel } from "./DeliveryPanel.js";
import { PreviewClient } from "./PreviewClient.js";

/**
 * Server component: every read happens here, on the server, through Drizzle.
 *
 * Asset URLs are resolved immediately before preview and handed down as props.
 * The client never learns a storage key, never holds a credential, and never
 * touches Postgres.
 */
export default async function ProjectPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  /**
   * Before anything is read, let alone rendered.
   *
   * This page approves films and links to the download, so it is the surface
   * where "anyone with the URL" mattered most. Signed out sends them to get a
   * link; somebody else's film is a 404, because a refusal that says "not
   * yours" confirms there is something there.
   */
  await guardProject(id, `/projects/${id}`);

  const loaded = await loadProjectForPreview(id);
  if (loaded === null) notFound();

  /**
   * Auth arrives in phase 8. Until then the approver IS the project owner.
   *
   * This used to pass the subject's name, which is not a user id and made
   * every approval fail on the foreign key the moment anyone pressed the
   * button — invisible until then, because approval was only ever exercised
   * through @film/db's tests and never through this page.
   *
   * Note what this does not do: check that the person looking at the page is
   * the owner. There is no session to check against. Anyone who can reach this
   * URL can approve the film, which is why the app is not deployable yet.
   */
  const approverId = loaded.summary.ownerId;

  /**
   * Loaded here, on the server, so the page arrives already knowing whether a
   * film exists. The panel polls from that starting point rather than opening
   * on "rendering" and correcting itself a few seconds later — a customer
   * returning to a finished film should not watch it pretend to still be
   * working.
   */
  // Non-null: loadProjectForPreview already established the id is well-formed
  // and the project exists.
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
