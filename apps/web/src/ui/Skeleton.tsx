import { cx } from "./cx.js";

/**
 * The shape of something on its way.
 *
 * Shown by the `loading.tsx` screens, which is what lets a tap change the
 * screen at once instead of freezing it until the server has finished. A
 * spinner says "wait"; a skeleton the shape of the next screen says "here it
 * comes", and the eye has already found where the heading will be.
 *
 * Decorative: the region holding them carries the one accessible "Loading".
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

/** The live region around a screen of skeletons: one "Loading", said once. */
export const Loading = ({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) => (
  <div role="status" aria-label="Loading" aria-busy className={className}>
    {children}
  </div>
);
