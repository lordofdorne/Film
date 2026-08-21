import Link from "next/link";

import { TryAgainButton } from "./TryAgainButton.js";

/**
 * The film could not be made, and saying so is the whole job.
 *
 * This page used to show "Putting your film together" for a project that had
 * already failed — because the check was "is there a cut yet", and a project
 * that died before compose has no cut and never will. So it sat there
 * refreshing itself every five seconds, reassuring somebody, for ever, while
 * the home page listed the same film as failed. Two screens disagreeing about
 * the same row, and the comforting one was the lie.
 *
 * What it must not say is "sorry, it is gone". Nothing IS gone: every
 * recording is in storage untouched, the failure is in the making of the film
 * and not in the material, and it can be made again once the fault is fixed.
 * That is the difference between a bad afternoon and a bereavement, and it
 * belongs on the screen.
 */
export const FailedNote = ({ projectId }: { readonly projectId: string }) => (
  <main style={styles.page}>
    <h1 style={styles.title}>We could not finish this film</h1>
    <p style={styles.blurb}>
      Something went wrong while putting it together, and it stopped rather than
      making you something broken.
    </p>
    <p style={styles.reassure}>
      <strong>Nothing has been lost.</strong> Every recording and photograph you gave
      us is exactly where it was — the fault is in the making, not the material, and
      the film can be made again once it is fixed.
    </p>
    <div style={styles.action}>
      <TryAgainButton projectId={projectId} />
    </div>
    <p style={styles.blurb}>
      Sometimes that is all it takes. If it stops in the same place, the fault is
      one we have to fix at our end — we can see that this happened, and you can
      reply to the email we sent you to hurry us along.
    </p>
    <nav style={styles.nav}>
      <Link href="/" style={styles.secondary}>
        Your films
      </Link>
    </nav>
  </main>
);

const styles = {
  page: {
    maxWidth: 620,
    margin: "0 auto",
    padding: "96px 24px",
    fontFamily: "system-ui, sans-serif",
    color: "#1a1a1a",
  },
  title: { fontSize: 26, fontWeight: 600, margin: 0, letterSpacing: -0.4 },
  blurb: { fontSize: 16, lineHeight: 1.6, color: "#555", margin: "16px 0 0" },
  reassure: {
    fontSize: 16,
    lineHeight: 1.6,
    color: "#3c5c4a",
    background: "#f3f9f5",
    border: "1px solid #cfe3d7",
    borderRadius: 10,
    padding: "14px 16px",
    margin: "18px 0 0",
  },
  action: { marginTop: 26 },
  nav: { display: "flex", gap: 12, marginTop: 30, flexWrap: "wrap" as const },
  secondary: {
    border: "1px solid #ccc",
    borderRadius: 8,
    padding: "11px 21px",
    fontSize: 15,
    textDecoration: "none",
    color: "#1a1a1a",
  },
} as const;
