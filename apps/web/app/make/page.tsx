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
    <main className="page stack-5">
      <h1 className="display">What kind of film?</h1>
      <p className="lede">
        You will be walked through it piece by piece — you can record here, upload
        things you already have, and stop and come back whenever you like.
      </p>

      <ul className="list">
        {templates.map((t) => (
          <li key={t.id} className="card choice">
            <div className="stack">
              <h2 className="heading">{t.displayName}</h2>
              <p className="muted">
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

