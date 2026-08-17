"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { accessToProject, currentUser, ensureUser } from "./auth.js";
import { sendMagicLink } from "./authActions.js";
import {
  completeUpload,
  createProjectFor,
  discardCapture,
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
  const user = await ensureUser();
  const created = await createProjectFor(user?.id ?? null, templateId, templateVersion);
  if (!created.ok) return created;
  redirect(`/projects/${created.projectId}`);
};

export type DetailResult =
  | { readonly ok: true; readonly linkSentTo: string | null }
  | { readonly ok: false; readonly error: string };

/**
 * One typed answer from a step sheet. Validation is the template's, in
 * @film/pipeline/capture, where it is tested against a real database.
 *
 * Saving the owner's address is also the moment sign-in becomes possible, so
 * the magic link goes out here — once, non-blocking, and only when the session
 * has no verified address of its own. Clicking it is what turns the typed
 * address into ownership; not clicking it costs nothing today.
 */
export const submitDetail = async (
  projectId: string,
  fieldId: string,
  value: string,
): Promise<DetailResult> => {
  const refused = await mine(projectId);
  if (refused !== null) return refused;

  const saved = await saveDetailFor(projectId, fieldId, value);
  if (!saved.ok) return saved;

  let linkSentTo: string | null = null;
  if (saved.target === "owner" && typeof saved.value === "string") {
    const user = await currentUser();
    if (user === null || user.email === null) {
      const sent = await sendMagicLink(saved.value, `/projects/${projectId}`);
      if (sent.ok) linkSentTo = saved.value;
    }
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: true, linkSentTo };
};

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

export const startTheFilm = async (
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const refused = await mine(projectId);
  if (refused !== null) return refused;

  const result = await startTheFilmFor(projectId);
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
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
