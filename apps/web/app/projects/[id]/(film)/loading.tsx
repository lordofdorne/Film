import { Loading, Skeleton } from "../../../../src/ui/index.js";

/**
 * The film page on its way: the overview while capturing, the preview after.
 * Both open with a heading over a block, so one shape serves both.
 */
export default function FilmLoading() {
  return (
    <Loading className="page ov stack-5">
      <div className="stack-3">
        <Skeleton width={90} height={14} />
        <Skeleton width="min(420px, 80%)" height={40} />
        <Skeleton width={220} height={16} />
      </div>
      <Skeleton height={120} />
      <Skeleton height={280} />
    </Loading>
  );
}
