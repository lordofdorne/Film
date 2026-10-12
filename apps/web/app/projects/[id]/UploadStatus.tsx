"use client";

import { useCapture } from "./CaptureProvider.js";

/**
 * Takes still on their way up, said once, where it stays visible: in the
 * wizard's bar and on the overview. Nothing when there is nothing to say.
 *
 * Since Keep stopped waiting for the upload this is the one place somebody can
 * see that a take is still going — and the one place a take that failed
 * every retry can be sent again from without hunting for its step.
 */
export const UploadStatus = () => {
  const { uploads } = useCapture();
  if (uploads.pending === 0) return null;

  const failed = Object.values(uploads.byStep).filter((u) => u.state === "failed");
  if (failed.length > 0) {
    return (
      <p className="upload-status upload-status--failed" role="alert">
        {failed.length === 1 ? "1 take did not save." : `${String(failed.length)} takes did not save.`}{" "}
        <button
          type="button"
          className="linklike"
          onClick={() => { for (const u of failed) uploads.retry(u.stepId); }}
        >
          Try again
        </button>
      </p>
    );
  }

  const going = uploads.pending;
  const percent = uploads.current === undefined ? null : Math.round(uploads.current * 100);
  return (
    <p className="upload-status" role="status">
      <span className="upload-status__dot" aria-hidden />
      {going === 1 ? "Saving 1 take" : `Saving ${String(going)} takes`}
      {percent !== null && percent < 100 ? ` · ${String(percent)}%` : ""}
    </p>
  );
};
