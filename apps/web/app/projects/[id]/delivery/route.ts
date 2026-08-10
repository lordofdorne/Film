import { NextResponse } from "next/server";
import { loadDelivery } from "../../../../src/server/project.js";

/**
 * The delivery state, for a page that is watching a render finish.
 *
 * Small on purpose. A delivery render takes minutes, so whatever the page
 * polls gets called a few hundred times per film — and the obvious
 * alternative, `router.refresh()`, would re-run the whole preview page each
 * time: every asset URL resolved, the EDL parsed and revalidated, the props
 * rebuilt. This reads a handful of rows and one head request instead.
 *
 * No storage key and no URL in the response. The page learns that a film
 * exists, what it will be called and how big it is; fetching it is the
 * download route's job, behind the same rules.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const state = await loadDelivery(id);
  if (state === null) {
    return NextResponse.json({ error: "no such project" }, { status: 404 });
  }
  return NextResponse.json(state, { headers: { "cache-control": "no-store" } });
}
