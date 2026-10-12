import type { FittedNote } from "../../../src/server/project.js";
import { Disclosure } from "../../../src/ui/index.js";

/**
 * How the answers were fitted, beside the preview: which ones lost words to
 * stay inside their share of the film, how much was used, and — one tap away
 * — exactly what was left out.
 *
 * Owner's rule: shortening is never a surprise. Somebody approving their
 * grandmother's film should not discover afterwards that the story about the
 * river is not in it. So it is said here, plainly, before Approve.
 *
 * The advice at the bottom is the one lever there is today, and it is a real
 * one: shaping always keeps the opening of an answer, so saying the important
 * thing first, in a new take, keeps it. "Put it back" waits for request-a-change.
 */
export const FittedAnswers = ({ fitted }: { readonly fitted: readonly FittedNote[] }) => {
  if (fitted.length === 0) return null;
  return (
    <section className="ui-card stack-4" aria-labelledby="fitted-title">
      <div>
        <h2 id="fitted-title" className="heading">
          How we fitted the answers
        </h2>
        <p className="muted">
          Each answer has a share of the film, so the whole of it stays about four minutes. Where
          more was said, we kept the strongest whole sentences, in the order they were said — never
          part of one. Every recording is still kept in full.
        </p>
      </div>
      <ul className="list fitted">
        {fitted.map((f) => (
          <li key={f.questionId} className="fitted__item">
            <p className="fitted__ask">{f.label}</p>
            <p className="tiny">
              We used {clock(f.usedMs)} of {clock(f.spokenMs)}.
            </p>
            <Disclosure
              summary={
                f.leftOut.length === 1
                  ? "What we left out"
                  : `What we left out · ${String(f.leftOut.length)} passages`
              }
            >
              <ul className="list fitted__left">
                {f.leftOut.map((passage, i) => (
                  <li key={i}>“{passage}”</li>
                ))}
              </ul>
            </Disclosure>
          </li>
        ))}
      </ul>
      <p className="tiny">
        Something important left out? Record that answer again and say it first — the opening of
        an answer is always kept.
      </p>
    </section>
  );
};

const clock = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
};
