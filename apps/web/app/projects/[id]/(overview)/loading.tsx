import { Skeleton } from "../../../../src/ui/index.js";

/**
 * A film's page, on its way: heading, progress, and a chapter of steps.
 *
 * The same page is the overview, the preview and the "being made" note, so
 * this is the shape they share — a heading and something under it — rather
 * than a promise about which one is coming.
 *
 * In its own route group, beside the wizard and never above it: a loading
 * screen above a step broke Continue on production builds (see
 * usePrefetchNext).
 */
export default function FilmLoading() {
  return (
    <main className="page ov" aria-busy="true" aria-label="Loading your film">
      <header className="ov-head">
        <Skeleton width={90} height={14} />
        <Skeleton width="70%" height={40} />
        <Skeleton height={8} round />
        <Skeleton width={200} height={16} />
      </header>
      <Skeleton height={96} />
      {[3, 2].map((rows, chapter) => (
        <section key={chapter} className="ov-chapter" aria-hidden>
          <Skeleton width={160} height={24} />
          <ul className="list ov-chapter__steps">
            {Array.from({ length: rows }, (_, i) => (
              <li key={i} className="ov-step">
                <Skeleton width={24} height={24} round />
                <Skeleton width="55%" height={18} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
