import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const ffprobeJson = async (path: string): Promise<unknown> => {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
};

export const ffmpeg = async (args: readonly string[]): Promise<string> => {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stderr;
};

export type MediaInfo = {
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  /** Degrees of display rotation the container asks for. */
  readonly rotationDeg: number;
};

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
};

export const probe = async (path: string): Promise<MediaInfo> => {
  const raw = (await ffprobeJson(path)) as {
    streams?: ProbeStream[];
    format?: { duration?: string };
  };
  const streams = raw.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");

  const durationSec = Number(raw.format?.duration ?? 0);
  const [num, den] = (video?.r_frame_rate ?? "0/1").split("/").map(Number);

  // Rotation lives in side data on modern files and in a tag on older ones.
  // A phone that records sideways and tags the rotation renders upside down if
  // this is ignored, which is the single most common real-world video bug.
  let rotationDeg = 0;
  for (const sd of video?.side_data_list ?? []) {
    if (typeof sd.rotation === "number") rotationDeg = ((sd.rotation % 360) + 360) % 360;
  }
  const tagged = video?.tags?.["rotate"];
  if (rotationDeg === 0 && tagged !== undefined) {
    rotationDeg = ((Number(tagged) % 360) + 360) % 360;
  }

  return {
    durationMs: Math.round(durationSec * 1000),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: num !== undefined && den ? num / den : 0,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    rotationDeg,
  };
};

/**
 * Where speech actually starts and stops inside a take.
 *
 * Subjects are asked to leave two seconds of quiet at each end, and they
 * variously leave one or five. Trimming to a fixed offset would clip the first
 * word of a fast starter and leave dead air on a slow one, so the boundaries
 * are measured rather than assumed.
 *
 * This is not voice activity detection — it is a level gate, and it will treat
 * a loud room as speech. That is the right trade for now: erring towards
 * including audio never cuts a word in half.
 */
export type SpeechRun = { readonly startMs: number; readonly endMs: number };

export const detectSpeechRuns = async (
  path: string,
  { noiseDb = -34, minSilenceSec = 0.35 }: { noiseDb?: number; minSilenceSec?: number } = {},
): Promise<SpeechRun[]> => {
  const info = await probe(path);
  const stderr = await ffmpeg([
    "-i", path,
    "-af", `silencedetect=noise=${String(noiseDb)}dB:d=${String(minSilenceSec)}`,
    "-f", "null", "-",
  ]);

  const silenceStarts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) =>
    Math.max(0, Math.round(Number(m[1]) * 1000)),
  );
  const silenceEnds = [...stderr.matchAll(/silence_end:\s*(-?[\d.]+)/g)].map((m) =>
    Math.round(Number(m[1]) * 1000),
  );

  // Invert the silence runs to get the speech runs.
  const runs: SpeechRun[] = [];
  let cursor = 0;
  for (let i = 0; i < silenceStarts.length; i++) {
    const start = silenceStarts[i] ?? 0;
    if (start > cursor) runs.push({ startMs: cursor, endMs: start });
    cursor = silenceEnds[i] ?? info.durationMs;
  }
  if (cursor < info.durationMs) runs.push({ startMs: cursor, endMs: info.durationMs });

  const usable = runs.filter((r) => r.endMs - r.startMs >= 300);
  // If detection produced nothing sensible, treat the whole take as speech
  // rather than silently returning an empty range.
  return usable.length > 0 ? usable : [{ startMs: 0, endMs: info.durationMs }];
};

/** First to last speech, pauses inside it preserved — they are usually meaning. */
export const speechSpan = (runs: readonly SpeechRun[]): SpeechRun => {
  const first = runs[0];
  const last = runs[runs.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error("cannot take a span of zero speech runs");
  }
  return { startMs: first.startMs, endMs: last.endMs };
};

/** Round down to the authoring grid so every cut lands exactly on a frame. */
export const toGrid = (ms: number, gridMs = 100): number => Math.round(ms / gridMs) * gridMs;
