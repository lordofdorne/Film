import { notFound } from "next/navigation";
import { loadProjectForPreview } from "../../../src/server/project.js";
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

  return (
    <PreviewClient
      summary={loaded.summary}
      props={loaded.props}
      approverId={approverId}
    />
  );
}
