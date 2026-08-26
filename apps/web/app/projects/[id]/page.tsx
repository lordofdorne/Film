import { notFound } from "next/navigation";
import { guardProject, sessionIdentity } from "../../../src/server/auth.js";
import { SetPasswordOffer } from "../../SetPasswordOffer.js";
import { loadWalkthroughView, withThumbnails } from "../../../src/server/capture.js";
import { loadDelivery, loadProjectForPreview } from "../../../src/server/project.js";
import { DeliveryPanel } from "./DeliveryPanel.js";
import { FailedNote } from "./FailedNote.js";
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

  /**
   * The URLs are minted here, after the status is known, and only on the
   * branch that draws them.
   *
   * Below this line the page is a preview and an approval, and it reads the
   * walk-through only to find the address somebody typed. It has no pictures
   * on it at all, so it mints nothing.
   */
  if (walkthrough.status === "capturing") {
    return <Hub walkthrough={await withThumbnails(walkthrough)} />;
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

  /**
   * "Keep this" has an obvious meaning here and nowhere earlier, so the second
   * and last offer of a password sits beside the finished film.
   *
   * Only for somebody who has no address on their identity yet, and none
   * pending: for everyone else it would be either meaningless or a second
   * email chasing a confirmation they already have.
   */
  const identity = await sessionIdentity();
  const owed = walkthrough.steps.find(
    (step) => step.kind === "detail" && step.field?.target === "owner",
  );
  const offer =
    delivery.kind === "ready" &&
    identity !== null &&
    identity.email === null &&
    identity.pendingEmail === null ? (
      <SetPasswordOffer
        defaultEmail={typeof owed?.value === "string" ? owed.value : ""}
        prompt="Set a password, so this film is easy to come back to"
      />
    ) : null;

  return (
    <PreviewClient
      summary={loaded.summary}
      props={loaded.props}
      delivery={
        <>
          <DeliveryPanel projectId={id} initial={delivery} />
          {offer}
        </>
      }
    />
  );
}
