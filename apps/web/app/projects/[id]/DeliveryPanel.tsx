"use client";

import { useEffect, useState } from "react";
import type { DeliveryState } from "../../../src/server/project.js";

/** A render takes minutes; this is often enough to feel immediate. */
const POLL_MS = 6_000;

/**
 * Stop asking eventually.
 *
 * Twenty minutes is comfortably past the far end of a normal render. Past it,
 * something is wrong that a page refresh will not fix, and a tab quietly
 * polling a dead pipeline for the rest of the day is worse than being told.
 */
const GIVE_UP_MS = 20 * 60 * 1000;

/**
 * What the customer sees about their finished film.
 *
 * This is the last surface in the product. Before it, the pipeline rendered a
 * film, wrote it to private storage, marked the project delivered — and told
 * nobody, which meant the whole system stopped one step short of the only
 * thing it was for.
 *
 * It polls rather than pushing. A render takes minutes and the tab is usually
 * left open, so the state has to change on its own; the alternative is a
 * customer sitting on "rendering" long after their film is ready because
 * nothing told the page to look again.
 */
export const DeliveryPanel = ({
  projectId,
  initial,
}: {
  readonly projectId: string;
  readonly initial: DeliveryState;
}) => {
  const [state, setState] = useState<DeliveryState>(initial);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (state.kind !== "rendering") return;

    let cancelled = false;
    const startedAt = Date.now();

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setGaveUp(true);
        return;
      }
      try {
        const response = await fetch(`/projects/${projectId}/delivery`, { cache: "no-store" });
        if (response.ok && !cancelled) setState((await response.json()) as DeliveryState);
      } catch {
        // A failed poll is a blip, not news. The next tick tries again, and
        // the give-up deadline is what bounds it.
      }
    };

    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, state.kind]);

  if (state.kind === "unapproved") return null;

  if (state.kind === "failed") {
    return (
      <section className="card panel panel--failed stack">
        <h2 className="heading">Something went wrong making this film</h2>
        <p className="lede">
          The pipeline stopped and did not produce a file. Nothing has been lost — the
          recordings are all still stored, and the film can be made again once the fault
          is fixed.
        </p>
      </section>
    );
  }

  if (state.kind === "rendering") {
    return (
      <section className="card panel stack">
        {/* Inline styles cannot declare keyframes, and this is the only one. */}
        <h2 className="heading">
          <span className="spinner" aria-hidden />
          Making your film
        </h2>
        <p className="lede">
          {gaveUp
            ? "This is taking much longer than it should. Reload the page — if it still says this, the render needs looking at."
            : "This usually takes a few minutes. You can close this page; the film will be here when you come back."}
        </p>
      </section>
    );
  }

  return (
    <section className="card panel panel--ready stack">
      <h2 className="heading">Your film is ready</h2>
      <div className="row">
        {/*
          A plain link, not a fetch-and-blob. The browser's own download
          handling gives a progress bar, resumes a broken transfer through the
          range header the route honours, and survives the tab being closed —
          none of which is worth reimplementing badly in JavaScript.
        */}
        <a href={`/projects/${projectId}/download`} download className="btn btn--primary">
          Download
        </a>
        <span className="muted">
          {state.filename}
          {state.byteSize !== null && (
            <span className="tiny"> · {(state.byteSize / 1e6).toFixed(0)} MB</span>
          )}
        </span>
      </div>
      <p className="lede">
        This is the full-quality file, mastered to −14 LUFS. It plays anywhere that
        plays MP4 — phones, televisions, editing software.
      </p>
    </section>
  );
};

