import { cx } from "./cx.js";

/**
 * The shape of something on its way, holding its place so nothing below it
 * moves when it arrives — the film player while its code loads, for one.
 *
 * Not a loading screen. `loading.tsx` screens were tried in Phase 8 and taken
 * out: any one above a wizard step broke Continue on a production build (see
 * usePrefetchNext).
 *
 * Decorative: whatever it stands in for is announced when it arrives.
 */
export const Skeleton = ({
  width,
  height,
  round = false,
  className,
}: {
  readonly width?: number | string;
  readonly height: number | string;
  /** A circle or a pill, for avatars and buttons. */
  readonly round?: boolean;
  readonly className?: string;
}) => (
  <span
    aria-hidden
    className={cx("ui-skel", round && "ui-skel--round", className)}
    style={{ width: width ?? "100%", height }}
  />
);
