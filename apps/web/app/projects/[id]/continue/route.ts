import { NextResponse } from "next/server";

import { accessToProject } from "../../../../src/server/auth.js";
import { loadWalkthroughView } from "../../../../src/server/capture.js";
import { nextHref } from "../../../../src/server/wizard.js";

/**
 * "Continue": wherever this film is up to.
 *
 * Pressing Start lands here, and so does the overview's Continue, and so would
 * a "pick up where you left off" link in an email. Nothing is stored about
 * where somebody was — the first unfinished thing, with its chapter's intro if
 * the chapter is untouched, is worked out from the rows each time.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const origin = new URL(request.url).origin;

  const access = await accessToProject(id);
  if (!access.allowed) {
    // Their own film behind the save sheet, or somebody else's 404: the film's
    // page knows which and says so.
    return NextResponse.redirect(new URL(`/projects/${id}`, origin));
  }

  const view = await loadWalkthroughView(id);
  if (view === null || view.status !== "capturing") {
    return NextResponse.redirect(new URL(`/projects/${id}`, origin));
  }
  return NextResponse.redirect(new URL(nextHref(id, view.steps, null), origin));
}
