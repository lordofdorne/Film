"use server";

import { revalidatePath } from "next/cache";

import { accessToProject, currentUser } from "./auth.js";
import { sendMagicLink } from "./authActions.js";
import {
  beginProject,
  completeUpload,
  discardCapture,
  mintUpload,
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

export const startProject = async (input: {
  readonly ownerEmail: string;
  readonly subjectName: string;
  readonly displayName: string;
  readonly age: number;
  readonly relationshipLabel?: string;
  readonly interviewerName?: string;
}): Promise<StartResult> => {
  const email = input.ownerEmail.trim();
  const subjectName = input.subjectName.trim();
  const displayName = input.displayName.trim() === "" ? subjectName : input.displayName.trim();

  if (!email.includes("@")) return { ok: false, error: "That does not look like an email address" };
  if (subjectName === "") return { ok: false, error: "Who is the film about?" };
  if (!Number.isInteger(input.age) || input.age < 1 || input.age > 120) {
    return { ok: false, error: "That age does not look right" };
  }

  /**
   * The address that owns the film is the signed-in one when there is a
   * session, and the typed one otherwise.
   *
   * Not a formality: taking the typed address from somebody who is already
   * signed in as somebody else would hand them a film they cannot see
   * afterwards, and would let anyone put a project into another person's
   * account by typing their address.
   */
  const signedIn = await currentUser();
  const owner = signedIn?.email ?? email;

  const projectId = await beginProject({
    ownerEmail: owner,
    subject: {
      subjectName,
      displayName,
      age: input.age,
      ...(input.relationshipLabel === undefined || input.relationshipLabel.trim() === ""
        ? {}
        : { relationshipLabel: input.relationshipLabel.trim() }),
      ...(input.interviewerName === undefined || input.interviewerName.trim() === ""
        ? {}
        : { interviewerName: input.interviewerName.trim() }),
    },
  });
  /**
   * Nobody is signed in, so send the link now rather than at the end.
   *
   * They keep going in this tab — nothing blocks — but the film already belongs
   * to that address, and the email is how they get back to it on another
   * device, or in six months when they want to watch it again. Failing to send
   * does not fail the project: they have a URL, and they can sign in later.
   */
  if (signedIn === null) {
    await sendMagicLink(owner, `/projects/${projectId}/capture`);
  }

  return { ok: true, projectId };
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
  if (result.ok) revalidatePath(`/projects/${projectId}/capture/${stepId}`);
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
  if (result.ok) revalidatePath(`/projects/${projectId}/capture/${stepId}`);
  return result;
};
