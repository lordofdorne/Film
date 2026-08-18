import { TEMPLATE_REGISTRY, resolveCaptureSteps, type Template } from "@film/templates";

import { ChooseButton } from "./ChooseButton.js";

/**
 * The first thing after Start: choosing what kind of film to make.
 *
 * Everything on a card is read out of the template — its name, how long the
 * finished film runs, how long the capturing takes. One template exists today
 * and nothing here knows that: a second entry in TEMPLATE_REGISTRY is a second
 * card, with no React changing.
 */
export default function MakePage() {
  const templates: Template[] = Object.values(TEMPLATE_REGISTRY).map((versions) => {
    const latest = Math.max(...Object.keys(versions).map(Number));
    return (versions as Record<number, Template>)[latest] as Template;
  });

  return (
    <main style={styles.page}>
      <h1 style={styles.title}>What kind of film?</h1>
      <p style={styles.blurb}>
        You will be walked through it piece by piece — you can record here, upload
        things you already have, and stop and come back whenever you like.
      </p>

      <ul style={styles.list}>
        {templates.map((t) => (
          <li key={t.id} style={styles.card}>
            <div>
              <h2 style={styles.name}>{t.displayName}</h2>
              <p style={styles.facts}>
                A {filmMinutes(t)}-minute film · about {captureMinutes(t)} minutes to put
                together
              </p>
            </div>
            <ChooseButton templateId={t.id} templateVersion={t.version} />
          </li>
        ))}
      </ul>
    </main>
  );
}

const filmMinutes = (t: Template): string => {
  const min = Math.round(t.targetDurationMs.min / 60_000);
  const max = Math.round(t.targetDurationMs.max / 60_000);
  return min === max ? String(min) : `${String(min)} to ${String(max)}`;
};

/** Honest, and from the same numbers the hub will count down from. */
const captureMinutes = (t: Template): number => {
  const seconds = resolveCaptureSteps(t, {})
    .filter((s) => s.required)
    .reduce((sum, s) => sum + s.estimatedSeconds, 0);
  return Math.max(1, Math.round(seconds / 60));
};

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
  list: {
    listStyle: "none",
    padding: 0,
    margin: "28px 0 0",
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  },
  card: {
    border: "1px solid #e4e4e4",
    borderRadius: 12,
    padding: "20px 22px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap" as const,
  },
  name: { fontSize: 20, fontWeight: 600, margin: 0 },
  facts: { fontSize: 14, color: "#666", margin: "6px 0 0" },
} as const;
