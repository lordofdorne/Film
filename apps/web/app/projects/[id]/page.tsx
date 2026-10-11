import { notFound } from "next/navigation";
import { guardProject, sessionIdentity } from "../../../src/server/auth.js";
import { loadWalkthroughView, withThumbnails } from "../../../src/server/capture.js";
import { loadDelivery, loadProjectForPreview } from "../../../src/server/project.js";
import { DeliveryPanel } from "./DeliveryPanel.js";
import { FailedNote } from "./FailedNote.js";
import { Hub, ownerEmailOf } from "./Hub.js";
import { PreviewClient } from "./PreviewClient.js";
import { SaveFilmSheet } from "./SaveFilmSheet.js";
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
  const guard = await guardProject(id, `/projects/${id}`);

  const walkthrough = await loadWalkthroughView(id);
  if (walkthrough === null) notFound();

  const identity = await sessionIdentity();
  const pendingEmail = identity?.pendingEmail ?? null;

  /**
   * Their own film, handed over while they had no account — before the gate
   * at "Make my film" existed, or by a confirmation they never opened. Nothing
   * below this line is shown to an identity that lives in one browser's
   * cookie: not the preview, not the download, not even whether it failed.
   */
  if (guard.needsAccount) {
    return (
      <main className="page page--narrow">
        <SaveFilmSheet
          projectId={id}
          purpose="watch"
          suggestedEmail={ownerEmailOf(walkthrough)}
          pendingEmail={pendingEmail}
        />
      </main>
    );
  }

  /**
   * The URLs are minted here, after the status is known, and only on the
   * branch that draws them.
   *
   * Below this line the page is a preview and an approval, and it reads the
   * walk-through only to find the address somebody typed. It has no pictures
   * on it at all, so it mints nothing.
   */
  if (walkthrough.status === "capturing") {
    return <Hub walkthrough={await withThumbnails(walkthrough)} pendingEmail={pendingEmail} />;
  }

  /**
   * A film that failed says so, before anything reassuring is rendered.
   *
   * This check used to be only "is there a cut yet", and a project that dies
   * before compose has no cut and never will — so it fell through to
   * "Putting your film together" and refreshed itself for ever, while the
   * home page listed the same film as failed. Of two screens disagreeing
   * about one row, the comforting one was the lie.
   */
  if (walkthrough.status === "failed") return <FailedNote projectId={id} />;

  const loaded = await loadProjectForPreview(id);
  if (loaded === null) {
    // Handed to the pipeline, nothing composed yet. The page between capture
    // and preview that used to be a 404.
    return <WorkingNote />;
  }

  const delivery = (await loadDelivery(id)) ?? { kind: "unapproved" as const };

  return (
    <PreviewClient
      summary={loaded.summary}
      props={loaded.props}
      delivery={<DeliveryPanel projectId={id} initial={delivery} />}
    />
  );
}
