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

  // Auth arrives in phase 8. Until then the approver is the project owner and
  // there is no session to read — deliberately explicit rather than a silent
  // placeholder that could survive into production.
  const approverId = loaded.summary.subject.subjectName;

  return (
    <PreviewClient
      summary={loaded.summary}
      props={loaded.props}
      approverId={approverId}
    />
  );
}
