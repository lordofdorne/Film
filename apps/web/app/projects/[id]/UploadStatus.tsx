"use client";

import { useUploadSummary, useUploads } from "./CaptureProvider.js";

/**
 * Takes still on their way up, said once, where it stays visible: in the
 * wizard's bar and on the overview. Nothing when there is nothing to say.
 *
 * Since Keep stopped waiting for the upload this is the one place somebody can
 * see that a take is still going — and the one place a take that failed
 * every retry can be sent again from without hunting for its step.
 */
export const UploadStatus = () => {
  const summary = useUploadSummary();
  const { retry } = useUploads();
  if (summary.pending === 0) return null;

  const failed = summary.failedSteps;
  if (failed.length > 0) {
    return (
      <p className="upload-status upload-status--failed" role="alert">
        {failed.length === 1 ? "1 take did not save." : `${String(failed.length)} takes did not save.`}{" "}
        <button
          type="button"
          className="linklike"
          onClick={() => { for (const stepId of failed) retry(stepId); }}
        >
          Try again
        </button>
      </p>
    );
  }

  const going = summary.pending;
  const percent = summary.current === undefined ? null : Math.round(summary.current * 100);
  return (
    <p className="upload-status" role="status">
      <span className="upload-status__dot" aria-hidden />
      {going === 1 ? "Saving 1 take" : `Saving ${String(going)} takes`}
      {percent !== null && percent < 100 ? ` · ${String(percent)}%` : ""}
    </p>
  );
};
