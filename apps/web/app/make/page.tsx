import { TEMPLATE_REGISTRY, resolveCaptureSteps, type Template } from "@film/templates";

import { Chip, Icon } from "../../src/ui/index.js";
import { ChooseButton } from "./ChooseButton.js";

export const metadata = { title: "Choose a film" };

/**
 * The first thing after Start: choosing what kind of film to make.
 *
 * Everything on a card is read out of the template — its name, its pitch, how
 * long the finished film runs, how long the capturing takes, what to have to
 * hand. One template exists today and nothing here knows that: a second entry
 * in TEMPLATE_REGISTRY is a second card, with no React changing.
 */
export default function MakePage() {
  const templates: Template[] = Object.values(TEMPLATE_REGISTRY).map((versions) => {
    const latest = Math.max(...Object.keys(versions).map(Number));
    return (versions as Record<number, Template>)[latest] as Template;
  });

  return (
    <main className="page page--wide make">
      <header className="make__head">
        <h1 className="display">What would you like to make?</h1>
        <p className="lede">
          Each kind of film walks you through it one step at a time. Record there and then,
          or upload what you already have — and stop and come back whenever you like.
        </p>
      </header>

      <ul className="list make__grid">
        {templates.map((t) => (
          <li key={t.id} className="template-card">
            <div className="template-card__poster" aria-hidden>
              <Icon name="film" size={40} />
              <span>{t.displayName}</span>
            </div>
            <div className="template-card__body">
              <h2 className="title">{t.displayName}</h2>
              <div className="row">
                <Chip>
                  <Icon name="play" size={14} />
                  A {filmMinutes(t)}-minute film
                </Chip>
                <Chip>
                  <Icon name="clock" size={14} />
                  About {captureMinutes(t)} minutes to make
                </Chip>
              </div>
              {t.pitch !== undefined && (
                <>
                  <p className="lede">{t.pitch.summary}</p>
                  <p className="muted">
                    <strong>Best for</strong> {t.pitch.bestFor.charAt(0).toLowerCase() + t.pitch.bestFor.slice(1)}.
                  </p>
                  <div className="stack">
                    <h3 className="heading">You will need</h3>
                    <ul className="list wz-prepare">
                      {t.pitch.youWillNeed.map((line) => (
                        <li key={line}>
                          <span className="wz-prepare__tick" aria-hidden>
                            <Icon name="check" size={16} strokeWidth={2.4} />
                          </span>
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
              <ChooseButton templateId={t.id} templateVersion={t.version} />
              <p className="tiny">No account needed to begin. Everything is saved as you go.</p>
            </div>
          </li>
        ))}
        <li className="template-card template-card--soon">
          <Icon name="plus" size={20} />
          <p><strong>More kinds of film are on the way.</strong></p>
          <p className="muted">One at a time, each made properly before the next.</p>
        </li>
      </ul>
    </main>
  );
}

const filmMinutes = (t: Template): string => {
  const min = Math.round(t.targetDurationMs.min / 60_000);
  const max = Math.round(t.targetDurationMs.max / 60_000);
  return min === max ? String(min) : `${String(min)} to ${String(max)}`;
};

/** Honest, and from the same numbers the wizard will count down from. */
const captureMinutes = (t: Template): number => {
  const seconds = resolveCaptureSteps(t, {})
    .filter((s) => s.required)
    .reduce((sum, s) => sum + s.estimatedSeconds, 0);
  return Math.max(1, Math.round(seconds / 60));
};
