"use server";

import { revalidatePath } from "next/cache";

import {
  clearStep,
  completeUpload,
  finishCapture,
  mintUpload,
  startCapture,
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

  const projectId = await startCapture({
    ownerEmail: email,
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
  return { ok: true, projectId };
};

export const mintUploadFor = async (
  projectId: string,
  stepId: string,
  contentType: string,
): Promise<{ ok: true; mint: Mint } | { ok: false; error: string }> =>
  mintUpload(projectId, stepId, contentType);

export const finishUpload = async (
  projectId: string,
  stepId: string,
  assetId: string,
  key: string,
  contentType: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const result = await completeUpload(projectId, stepId, assetId, key, contentType);
  if (result.ok) revalidatePath(`/projects/${projectId}/capture/${stepId}`);
  return result;
};

export const startTheFilm = async (
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const result = await finishCapture(projectId);
  if (result.ok) revalidatePath(`/projects/${projectId}`);
  return result;
};

export const discardStep = async (
  projectId: string,
  stepId: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const result = await clearStep(projectId, stepId);
  if (result.ok) revalidatePath(`/projects/${projectId}/capture/${stepId}`);
  return result;
};
