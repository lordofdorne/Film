import { StartForm } from "./StartForm.js";

export default function StartPage() {
  return (
    <main style={styles.page}>
      <h1 style={styles.title}>Make a Life Advice film</h1>
      <p style={styles.blurb}>
        You will be walked through it one step at a time — ten questions to ask, three
        photographs to find, and a few short pieces of film. You can record here or
        upload something you already have, and you can stop and come back whenever you
        like.
      </p>
      <p style={styles.blurb}>First, six things about the person it is for.</p>
      <StartForm />
    </main>
  );
}

const styles = {
  page: {
    maxWidth: 620,
    margin: "0 auto",
    padding: "48px 24px 96px",
    fontFamily: "system-ui, sans-serif",
    color: "#1a1a1a",
  },
  title: { fontSize: 30, fontWeight: 600, margin: 0, letterSpacing: -0.5 },
  blurb: { fontSize: 16, lineHeight: 1.6, color: "#555", margin: "16px 0 0" },
} as const;
