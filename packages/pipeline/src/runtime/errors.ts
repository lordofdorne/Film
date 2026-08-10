import type { FailureClass } from "@film/db";

/**
 * A failure that has been classified on purpose.
 *
 * Whether a failure is worth retrying is a judgement about the cause, not
 * something to infer from an error string at the point of despair. Corrupt
 * media is just as corrupt on the fourth attempt and retrying it burns a
 * worker; a provider timeout usually will not recur. So a stage says which it
 * is, and anything that does not say is treated as transient and bounded by
 * the attempt limit.
 */
export class StageError extends Error {
  readonly failureClass: FailureClass;
  /** Safe to store on the row and show in an operator UI. No stack, no paths. */
  readonly summary: string;

  constructor(failureClass: FailureClass, summary: string, options?: { cause?: unknown }) {
    super(summary, options as ErrorOptions);
    this.name = "StageError";
    this.failureClass = failureClass;
    this.summary = summary;
  }
}

/** The input cannot produce a result. Retrying will fail the same way. */
export const permanent = (summary: string, cause?: unknown): StageError =>
  new StageError("permanent", summary, cause === undefined ? undefined : { cause });

/** Something outside this stage went wrong. Worth another attempt. */
export const transient = (summary: string, cause?: unknown): StageError =>
  new StageError("transient", summary, cause === undefined ? undefined : { cause });

/** The work is no longer wanted — the project was deleted, or the worker is draining. */
export const cancelled = (summary: string, cause?: unknown): StageError =>
  new StageError("cancelled", summary, cause === undefined ? undefined : { cause });

/**
 * An unclassified throw is transient.
 *
 * The most common unknown failure in a system like this is infrastructure, not
 * bad input, so the default errs towards retrying — and the attempt limit stops
 * a genuine bug from retrying forever.
 */
export const classify = (error: unknown): StageError => {
  if (error instanceof StageError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new StageError("transient", message, { cause: error });
};

/**
 * What may be written to the stage_executions row.
 *
 * Stack traces and absolute paths go to stage_events and to the process log,
 * where an operator can read them; this column is the one a customer-facing
 * surface is most likely to end up rendering.
 */
export const sanitise = (message: string): string =>
  message
    .replace(/\/[^\s:]*\/(?=[A-Za-z0-9_.-]+)/g, "")
    .split("\n")[0]
    ?.slice(0, 500) ?? "unknown error";
