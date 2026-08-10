import { mkdtemp, rm, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Scratch space for a stage, and the check that there is room for it.
 *
 * A render pulls every source clip to local disk, writes a mezzanine and then
 * a delivery file. On a container with a small ephemeral disk, several of
 * those at once fills it — and a full disk does not fail cleanly. FFmpeg
 * writes a truncated file, the loudness check passes on the fragment it can
 * read, and a broken film reaches a customer. So the space is checked BEFORE
 * the work is claimed, and the directory is removed whether or not the stage
 * succeeded.
 */

export const workRoot = (): string => process.env["WORKER_TMP"] ?? tmpdir();

export const freeBytes = async (path: string): Promise<number> => {
  const fs = await statfs(path);
  return fs.bavail * fs.bsize;
};

export class InsufficientDiskError extends Error {
  constructor(
    readonly requiredBytes: number,
    readonly availableBytes: number,
  ) {
    super(
      `needs ${(requiredBytes / 1e9).toFixed(1)} GB of scratch space, ` +
        `${(availableBytes / 1e9).toFixed(1)} GB free`,
    );
    this.name = "InsufficientDiskError";
  }
};

/**
 * Whether there is room to attempt a stage.
 *
 * Returning false rather than throwing is deliberate: this is asked before
 * claiming, and "no room right now" must put the job back on the queue for
 * another worker, not mark the stage failed on this one.
 */
export const hasFreeSpace = async (requiredBytes: number): Promise<boolean> =>
  (await freeBytes(workRoot())) >= requiredBytes;

/**
 * Run something with a private scratch directory, removed on the way out.
 *
 * The cleanup is in `finally` and swallows its own errors. A stage that failed
 * has already produced the interesting error; losing it behind an unlink
 * failure would be a bad trade, and the worst case of a failed cleanup is a
 * directory the next boot's sweep collects.
 */
export const withWorkdir = async <T>(
  prefix: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> => {
  const dir = await mkdtemp(join(workRoot(), `film-${prefix}-`));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

/**
 * Remove scratch directories left behind by a worker that was killed.
 *
 * SIGKILL, an OOM kill and a node crash all skip the `finally` above, and on a
 * long-lived container those directories accumulate until the disk is the
 * problem. Run once at boot, when nothing of ours is using them.
 */
export const sweepAbandonedWorkdirs = async (olderThanMs = 6 * 60 * 60 * 1000): Promise<number> => {
  const { readdir, stat } = await import("node:fs/promises");
  const root = workRoot();
  let removed = 0;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("film-")) continue;
    const path = join(root, entry.name);
    const info = await stat(path).catch(() => null);
    if (info === null || Date.now() - info.mtimeMs < olderThanMs) continue;
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
    removed += 1;
  }
  return removed;
};
