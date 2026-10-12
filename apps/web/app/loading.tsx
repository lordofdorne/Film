import { Loading, Skeleton } from "../src/ui/index.js";

/**
 * Any page outside the film on its way: home, the chooser, sign-in, account.
 * A heading and a few cards — near enough the shape of each that the screen
 * changes the moment somebody taps, rather than when the server is done.
 */
export default function PageLoading() {
  return (
    <Loading className="page page--wide stack-5">
      <Skeleton width="min(320px, 70%)" height={40} />
      <div className="lib-grid">
        <Skeleton height={200} />
        <Skeleton height={200} />
        <Skeleton height={200} />
      </div>
    </Loading>
  );
}
