import { Skeleton } from "../../src/ui/index.js";

/**
 * Home, on its way: the shape of the film list, so a tap on the logo or on
 * "Save and leave" changes the screen at once instead of freezing it.
 *
 * In its own route group so it wraps home and nothing else. A loading screen
 * above a wizard step broke Continue on production builds (see
 * usePrefetchNext); this one is beside the wizard, never above it.
 *
 * Every block waits 120ms before showing (see Skeleton), so a fast answer
 * never flashes grey.
 */
export default function HomeLoading() {
  return (
    <main className="page page--wide home" aria-busy="true" aria-label="Loading your films">
      <header className="lib-head">
        <Skeleton width={220} height={40} />
        <Skeleton width={180} height={48} round />
      </header>
      <Skeleton height={148} />
      <ul className="list lib-grid" aria-hidden>
        {[0, 1, 2].map((i) => (
          <li key={i} className="film-card">
            <Skeleton height="auto" className="film-card__poster" />
            <span className="film-card__body">
              <Skeleton width="60%" height={20} />
              <Skeleton width={72} height={24} round />
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
