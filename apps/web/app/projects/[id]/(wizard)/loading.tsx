import { Loading, Skeleton } from "../../../../src/ui/index.js";

/**
 * A wizard screen on its way, inside a frame that never left.
 *
 * The bar is the layout's, so it stays put with the right step already named;
 * only the middle is a placeholder, and only until the page arrives. Usually
 * that is never: the next step is prefetched in full while this one is open.
 */
export default function StepLoading() {
  return (
    <Loading className="wz-body">
      <Skeleton width={120} height={14} />
      <div className="stack-2">
        <Skeleton height={34} />
        <Skeleton width="70%" height={34} />
      </div>
      <Skeleton height="min(48dvh, 300px)" className="wz-skel-vf" />
    </Loading>
  );
}
