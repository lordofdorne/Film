"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { accessToProject, authConfigured, currentUser, ensureUser } from "./auth.js";
import { retryFilm } from "./project.js";
import { nextHref } from "./wizard.js";
import {
  completeUpload,
  createProjectFor,
  deleteFilmFor,
  discardCapture,
  loadWalkthroughView,
  mintUpload,
  saveDetailFor,
  startTheFilmFor,
  type Mint,
} from "./capture.js";

/**
 * The walk-through's server actions.
 *
 * Thin: every decision they make lives in ./capture.ts, which is plain server
 * code and can be reasoned about without Next's request context. These exist
 * to be callable from a client component and to invalidate the page after a
 * write, and for nothing else.
 */

/**
 * The same refusal for a film that is not yours and one that does not exist.
 *
 * Server actions are callable directly, so a guard on the page that renders
 * them is not a guard at all: without this, knowing a project id would still be
 * enough to add media to somebody else's film. Every action that names a
 * project checks it here.
 */
const mine = async (projectId: string): Promise<{ ok: false; error: string } | null> => {
  const access = await accessToProject(projectId);
  return access.allowed ? null : { ok: false, error: "no such project" };
};

export type StartResult =
  | { readonly ok: true; readonly projectId: string }
  | { readonly ok: false; readonly error: string };

/**
 * The chooser chose. Sign the browser in (anonymously if nobody is), create
 * the project, and land on its hub. The template id came over the wire, so
 * startCapture treats it as a claim to verify, not a fact.
 */
export const chooseFilm = async (
  templateId: string,
  templateVersion: number,
): Promise<StartResult> => {
  let user;
  try {
    user = await ensureUser();
  } catch (error: unknown) {
    // Usually anonymous sign-ins disabled on the Supabase project. A button
    // that says why beats a button that seems to do nothing — that bug is the
    // one this whole redesign started from.
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const created = await createProjectFor(user?.id ?? null, templateId, templateVersion);
  if (!created.ok) return created;
  // Straight to the first screen — the first chapter's intro — rather than
  // via /continue: a server action's redirect into a route handler leaves
  // that handler's URL in the address bar.
  const view = await loadWalkthroughView(created.projectId);
  redirect(
    view === null
      ? `/projects/${created.projectId}`
      : nextHref(created.projectId, view.steps, null),
  );
};

export type DetailResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * One typed answer from a step sheet. Validation is the template's, in
 * @film/pipeline/capture, where it is tested against a real database.
 */
export const submitDetail = async (
  projectId: string,
  fieldId: string,
  value: string,
  /** Where to go once saved; the wizard's next stop, worked out by the page. */
  then?: string,
): Promise<DetailResult> => {
  const refused = await mine(projectId);
  if (refused !== null) return refused;

  const saved = await saveDetailFor(projectId, fieldId, value);
  if (!saved.ok) return saved;

  revalidatePath(`/projects/${projectId}`);

  /**
   * Saved: go on from here.
   *
   * The client used to `router.push` after this returned. Redirecting from the
   * action is Next's documented "save, then go", and it is one round trip
   * instead of two: the next page comes back in this response.
   *
   * Only within this film, so the parameter cannot send anybody elsewhere.
   */
  if (then !== undefined && withinFilm(projectId, then)) redirect(then);
  return { ok: true };
};

const withinFilm = (projectId: string, href: string): boolean =>
  href === `/projects/${projectId}` || href.startsWith(`/projects/${projectId}/`);

export const mintUploadFor = async (
  projectId: string,
  stepId: string,
  contentType: string,
): Promise<{ ok: true; mint: Mint } | { ok: false; error: string }> =>
  (await mine(projectId)) ?? mintUpload(projectId, stepId, contentType);

export const finishUpload = async (
  projectId: string,
  stepId: string,
  assetId: string,
  key: string,
  contentType: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const refused = await mine(projectId);
  if (refused !== null) return refused;

  const result = await completeUpload(projectId, stepId, assetId, key, contentType);
  if (result.ok) {
    revalidatePath(`/projects/${projectId}/step/${stepId}`);
    // The hub's card for this step ticks the moment they walk back to it.
    revalidatePath(`/projects/${projectId}`);
  }
  return result;
};

export type StartFilmResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string; readonly needsAccount?: true };

/**
 * Make my film, for somebody already signed in to an account.
 *
 * An anonymous owner is refused, and the button knows to ask them to create
 * an account or sign in instead — which makes the film in the same step (see
 * `createAccount`). The finished film is watched and downloaded from that
 * account, so it is never handed over to a browser that could lose it.
 */
export const startTheFilm = async (projectId: string): Promise<StartFilmResult> => {
  const refused = await mine(projectId);
  if (refused !== null) return refused;

  if (authConfigured()) {
    const user = await currentUser();
    if (user === null || user.email === null) {
      return { ok: false, error: "Create an account or sign in to make your film.", needsAccount: true };
    }
  }

  const result = await startTheFilmFor(projectId);
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
};

/**
 * "Try again", from the screen that says the film could not be made.
 *
 * The one action a person had no way to take: the film was stuck, the page
 * said so, and the only thing that could move it was somebody with a database
 * client. Guarded like every other action here — knowing a project id is not
 * the same as owning the film.
 */
export const tryAgain = async (
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const refused = await mine(projectId);
  if (refused !== null) return refused;

  const result = await retryFilm(projectId);
  if (!result.ok) return result;

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  return { ok: true };
};

/**
 * Delete a film for good, and go home.
 *
 * Only the owner, and only while it is not approved (deleteFilm says which).
 * Success redirects, so nothing comes back to a page that no longer has a
 * film to show; only a refusal resolves with a value.
 */
export const deleteFilmAction = async (projectId: string): Promise<{ ok: false; error: string }> => {
  const refused = await mine(projectId);
  if (refused !== null) return refused;

  const result = await deleteFilmFor(projectId);
  if (!result.ok) return result;
  revalidatePath("/");
  redirect("/");
};

export const discardStep = async (
  projectId: string,
  stepId: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const refused = await mine(projectId);
  if (refused !== null) return refused;

  const result = await discardCapture(projectId, stepId);
  if (result.ok) {
    revalidatePath(`/projects/${projectId}/step/${stepId}`);
    revalidatePath(`/projects/${projectId}`);
  }
  return result;
};
