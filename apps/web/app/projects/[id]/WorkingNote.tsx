"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Button, Icon, Working } from "../../../src/ui/index.js";

/**
 * Between capture and preview: the film is handed over and compose has not
 * written a cut yet. Checks again every few seconds so the preview appears on
 * its own — nobody should have to know that refreshing is a thing.
 *
 * The stages are named in plain words and only as far as this page can
 * honestly know them: everything arrived (true, or it would not be here), the
 * first cut is being made (true until it exists), and what comes after.
 * There is no percentage, because there is nothing to compute one from.
 */
export const WorkingNote = () => {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [router]);

  return (
    <main className="page state-page">
      <span className="state-page__icon" aria-hidden>
        <Icon name="film" size={32} />
      </span>
      <h1 className="display">We are putting your film together</h1>
      <p className="lede">
        The first cut usually takes a few minutes. This page will change on its own
        when it is ready to watch.
      </p>
      <Working label="Making the first cut" />
      <ol className="list stages" aria-label="What happens now">
        <li className="stages__item stages__item--done">
          <span className="stages__mark" aria-hidden><Icon name="check" size={14} strokeWidth={2.6} /></span>
          Everything you recorded arrived safely
        </li>
        <li className="stages__item stages__item--now" aria-current="step">
          <span className="stages__mark" aria-hidden />
          Choosing the moments and cutting the first version
        </li>
        <li className="stages__item">
          <span className="stages__mark" aria-hidden />
          You watch it, and approve it when it is right
        </li>
        <li className="stages__item">
          <span className="stages__mark" aria-hidden />
          We make the full-quality film for you to keep
        </li>
      </ol>
      <p className="muted">You can close this page — the film will be under Your films when you come back.</p>
      <Button variant="secondary" asChild>
        <Link href="/">Your films</Link>
      </Button>
    </main>
  );
};
