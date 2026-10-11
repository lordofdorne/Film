"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { DeliveryState } from "../../../src/server/project.js";
import { Button, Icon, Notice, Working } from "../../../src/ui/index.js";

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
      <Notice tone="warn" title="Something went wrong making the final file">
        It stopped without producing one. Nothing has been lost — every recording is still
        stored, and the film can be made again.
      </Notice>
    );
  }

  if (state.kind === "rendering") {
    return (
      <section className="delivery delivery--working" aria-live="polite">
        <div className="delivery__head">
          <span className="delivery__icon" aria-hidden>
            <Icon name="film" size={24} />
          </span>
          <div>
            <h2 className="heading">Making your film</h2>
            <p className="muted">
              {gaveUp
                ? "This is taking much longer than it should. Reload the page — if it still says this, the film needs looking at."
                : "The full-quality file usually takes a few minutes. You can close this page; your film will be here when you come back."}
            </p>
          </div>
        </div>
        {!gaveUp && <Working label="Making the full-quality film" />}
      </section>
    );
  }

  return (
    <section className="delivery delivery--ready" aria-live="polite">
      <div className="delivery__head">
        <span className="delivery__icon delivery__icon--ready" aria-hidden>
          <Icon name="check" size={24} strokeWidth={2.4} />
        </span>
        <div>
          <h2 className="title">Your film is ready</h2>
          <p className="muted">
            {state.filename}
            {state.byteSize !== null && ` · ${(state.byteSize / 1e6).toFixed(0)} MB`}
          </p>
        </div>
      </div>
      <div className="delivery__actions">
        {/*
          A plain link, not a fetch-and-blob. The browser's own download
          handling gives a progress bar, resumes a broken transfer through the
          range header the route honours, and survives the tab being closed —
          none of which is worth reimplementing badly in JavaScript.
        */}
        <Button size="lg" asChild>
          <a href={`/projects/${projectId}/download`} download>
            <Icon name="download" size={20} />
            Download the film
          </a>
        </Button>
        <Button size="lg" variant="secondary" asChild>
          <Link href="/make">Make another</Link>
        </Button>
      </div>
      <p className="tiny">
        The full-quality file. It plays on phones, televisions and computers, and in any
        editing software.
      </p>
    </section>
  );
};
