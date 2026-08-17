"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { accessToProject, currentUser, ensureUser } from "./auth.js";
import { sendMagicLink } from "./authActions.js";
import {
  beginProject,
  completeUpload,
  createProjectFor,
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
  // The hub. Until Block 5 lands it, the walk-through entry stands in.
  redirect(`/projects/${created.projectId}/capture`);
};

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
   * The browser is signed in before the project exists — anonymously if nobody
   * is — so the film is owned properly from birth and every guard on every
   * surface works unchanged. No pass, no placeholder.
   */
  const user = await ensureUser();

  const projectId = await beginProject({
    ownerId: user?.id ?? null,
    ownerEmail: email,
    subject: {
      subjectName,
      displayName,
      age: input.age,
      ...(input.relationshipLabel === undefined || input.relationshipLabel.trim() === ""
        ? {}
        : { relationshipLabel: input.relationshipLabel.trim() }),
    },
  });

  /**
   * An anonymous owner gets the link now rather than at the end: clicking it
   * proves the address and moves this film to the verified identity. Nothing
   * blocks — they keep going in this tab — and failing to send does not fail
   * the project, because they can sign in later.
   */
  if (user === null || user.email === null) {
    await sendMagicLink(email, `/projects/${projectId}/capture`);
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
