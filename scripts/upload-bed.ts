/**
 * Puts a music bed where the capture flow can find it.
 *
 *   pnpm bed:upload
 *
 * A customer is never going to upload a music track, so the bed cannot arrive
 * the way intake's does — as a file somebody dropped in a directory. An
 * operator loads each track once, and every project made in the browser takes
 * its own copy at the moment it is started.
 *
 * Reads the music block of incoming/project.json, which is the same
 * description intake already uses, so there is one place a bed is specified
 * rather than two that can disagree.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { storeFromEnv } from "@film/storage";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INCOMING = join(ROOT, "incoming");

type MusicBlock = {
  trackId: string;
  title: string;
  sourceFile: string;
  cropStartMs: number;
  cropEndMs: number;
  crossfadeMs: number;
  targetDurationMs: number;
};

const main = async (): Promise<void> => {
  const project = JSON.parse(await readFile(join(INCOMING, "project.json"), "utf8")) as {
    music?: MusicBlock;
  };
  const music = project.music;
  if (music === undefined) {
    throw new Error("incoming/project.json has no music block, so there is no bed to upload");
  }

  const store = storeFromEnv();
  const sourceKey = `tracks/${music.trackId}/source.mp3`;
  const bytes = await readFile(join(INCOMING, music.sourceFile));
  const stored = await store.put(sourceKey, new Uint8Array(bytes), { contentType: "audio/mpeg" });

  /**
   * The crop alongside the audio, not in code.
   *
   * Where a bed starts, how long a loop is and how it crossfades are
   * properties of that recording. Keeping them next to it means loading a
   * second track is an upload rather than a deployment.
   */
  const spec = {
    trackId: music.trackId,
    title: music.title,
    cropStartMs: music.cropStartMs,
    cropEndMs: music.cropEndMs,
    crossfadeMs: music.crossfadeMs,
    targetDurationMs: music.targetDurationMs,
    sourceKey,
  };
  await store.put(
    `tracks/${music.trackId}/bed.json`,
    new TextEncoder().encode(JSON.stringify(spec, null, 2)),
    { contentType: "application/json" },
  );

  process.stdout.write(
    `uploaded bed "${music.title}" (${(stored.byteSize / 1e6).toFixed(1)} MB)\n` +
      `  ${sourceKey}\n` +
      `  tracks/${music.trackId}/bed.json\n\n` +
      `  CAPTURE_BED_TRACK_ID=${music.trackId}\n`,
  );
};

await main();
