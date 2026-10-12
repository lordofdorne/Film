import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";

import { ffmpeg, type RunOptions } from "./ffmpeg.js";

const run = promisify(execFile);

/**
 * Speech to text, on this machine, for nothing.
 *
 * Spawned like ffmpeg rather than linked as a library, and for the same
 * reasons: the heavy lifting is a C++ program that is better at its job than
 * anything in npm, it is already how this codebase talks to media tools, and a
 * native addon that fails to build turns `pnpm install` into an afternoon.
 *
 * Local is not a compromise here, it is the requirement. These are recordings
 * of somebody's grandmother, and the licence question that blocked this
 * decision for days — does the provider train on customer audio — has exactly
 * one answer that cannot be got wrong: the audio never leaves the machine that
 * made the film. It also costs nothing per film, for ever.
 *
 * Word times, since Phase 9: a second, timed pass. Whisper's times run early
 * and stretch over silences, so they are not used as they come — the editor
 * moves each word onto the speech INGEST measured from the waveform
 * (`alignToRuns` in @film/editors). What whisper is good at, and ingest cannot
 * do, is saying which words were in which stretch of speech.
 */

export type TimedWord = { readonly text: string; readonly startMs: number; readonly endMs: number };

export type Transcript = {
  readonly text: string;
  /** `text`, word by word, with times from the timed pass. */
  readonly words: readonly TimedWord[];
  readonly engine: string;
  readonly model: string;
  readonly language: string;
};

/** The binary, and the model it reads. Both overridable; neither guessed. */
const BIN = (): string => process.env["WHISPER_BIN"] ?? "whisper-cli";
const MODEL = (): string => process.env["WHISPER_MODEL"] ?? "";
const LANGUAGE = (): string => process.env["WHISPER_LANGUAGE"] ?? "en";

export const transcriptionConfigured = (): boolean => MODEL() !== "";

/**
 * The one sample rate whisper.cpp accepts: 16 kHz mono signed 16-bit.
 *
 * Feeding it anything else fails in a way that reads like a corrupt file, so
 * the conversion is not optional and not a detail — it is the interface.
 */
export const extractSpeechAudio = async (
  input: string,
  output: string,
  options?: RunOptions,
): Promise<void> => {
  await rm(output, { force: true });
  await ffmpeg(
    ["-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output],
    options,
  );
};

/**
 * The words in one take.
 *
 * Two passes over the same audio, because asking for timestamps changes what
 * whisper writes. Measured on 2026-10-12: with timestamps on, one take came
 * back with no punctuation at all, and another turned a full stop into a comma
 * and heard an extra "like" the untimed pass did not. The editor
 * finds sentences by their full stops, so the untimed pass decides the words
 * and the timed one (`--max-len 1 --split-on-word`, a segment per word) only
 * lends them times. About two seconds each for a thirty-second answer, here. The transcript is
 * written to a file rather than read from stdout: whisper.cpp interleaves
 * progress and model information there, and a parser that has to tell them
 * apart is a parser that will one day get it wrong quietly.
 */
export const transcribeAudio = async (
  wavPath: string,
  options: RunOptions & { readonly threads?: number } = {},
): Promise<Transcript> => {
  const model = MODEL();
  if (model === "") {
    throw new Error(
      "WHISPER_MODEL is not set, so nothing can be transcribed and no film can be cut. " +
        "Point it at a ggml model file — see docs/CHECKPOINT.md.",
    );
  }

  const base = `${wavPath}.transcript`;
  const txt = `${base}.txt`;
  await rm(txt, { force: true });

  const args = [
    "--model", model,
    "--file", wavPath,
    "--language", LANGUAGE(),
    "--no-timestamps",
    "--output-txt",
    "--output-file", base,
    ...(options.threads === undefined ? [] : ["--threads", String(options.threads)]),
  ];

  await whisper(args, options);

  const raw = await readFile(txt, "utf8").catch(() => "");
  await rm(txt, { force: true });
  // Whisper pads with newlines and leading spaces between segments; the
  // film's caption layout counts words, so collapse it to one paragraph.
  const text = raw.replace(/\s+/g, " ").trim();

  const timedBase = `${wavPath}.words`;
  const json = `${timedBase}.json`;
  await rm(json, { force: true });
  await whisper(
    [
      "--model", model,
      "--file", wavPath,
      "--language", LANGUAGE(),
      "--max-len", "1",
      "--split-on-word",
      "--output-json",
      "--output-file", timedBase,
      ...(options.threads === undefined ? [] : ["--threads", String(options.threads)]),
    ],
    options,
  );
  const timed = parseTimedWords(await readFile(json, "utf8").catch(() => "{}"));
  await rm(json, { force: true });

  return {
    text,
    words: attachTimings(text.split(" ").filter((w) => w.length > 0), timed),
    engine: "whisper.cpp",
    model: model.split("/").pop() ?? model,
    language: LANGUAGE(),
  };
};

const whisper = async (args: readonly string[], options: RunOptions): Promise<void> => {
  try {
    await run(BIN(), [...args], {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error: unknown) {
    const e = error as { code?: unknown; stderr?: string; message?: string };
    if (e.code === "ENOENT") {
      throw new Error(
        `${BIN()} is not on PATH. Install whisper.cpp (\`brew install whisper-cpp\`) ` +
          "or set WHISPER_BIN.",
      );
    }
    throw new Error(`whisper failed: ${e.stderr?.trim() ?? e.message ?? String(error)}`);
  }
};

/**
 * The timed pass's words, from whisper.cpp's JSON: one segment per word with
 * `offsets.from`/`offsets.to` in milliseconds. Empty segments and whisper's
 * bracketed non-speech markers ("[MUSIC PLAYING]") are not words.
 */
export const parseTimedWords = (raw: string): TimedWord[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const segments = (parsed as { transcription?: unknown }).transcription;
  if (!Array.isArray(segments)) return [];
  const words: TimedWord[] = [];
  for (const segment of segments as { text?: unknown; offsets?: { from?: unknown; to?: unknown } }[]) {
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    const from = segment.offsets?.from;
    const to = segment.offsets?.to;
    if (text === "" || /^\[.*\]$/.test(text) || typeof from !== "number" || typeof to !== "number") {
      continue;
    }
    for (const piece of text.split(/\s+/)) words.push({ text: piece, startMs: from, endMs: Math.max(to, from + 1) });
  }
  return words;
};

/** Lower case, letters and digits and apostrophes only: "Now." and "now" match. */
const comparable = (word: string): string => word.toLowerCase().replace(/[^a-z0-9']/g, "");

/**
 * The untimed pass's words, with the timed pass's times.
 *
 * The two passes mostly agree, word for word, and differ in small ways — a
 * "like" one heard and the other did not, "trip," against "trip." — so the
 * words are matched as a longest common subsequence on their letters, and a
 * word with no partner takes its time from between its matched neighbours.
 * Every word of `text` gets a time, in order, and the words are exactly
 * `text`'s: what is said on screen is never the timed pass's version.
 */
export const attachTimings = (
  words: readonly string[],
  timed: readonly TimedWord[],
): TimedWord[] => {
  if (words.length === 0) return [];
  if (timed.length === 0) return [];

  const a = words.map(comparable);
  const b = timed.map((w) => comparable(w.text));
  // LCS table, from the end, so the walk below goes forwards.
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = table[i] ?? [];
    const below = table[i + 1] ?? [];
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] && a[i] !== "" ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const match: (number | undefined)[] = new Array<number | undefined>(n).fill(undefined);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j] && a[i] !== "") {
      match[i] = j;
      i++;
      j++;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) i++;
    else j++;
  }

  // Unmatched words share the gap between the matched words either side.
  const result: TimedWord[] = [];
  let i = 0;
  while (i < n) {
    const j = match[i];
    if (j !== undefined) {
      const t = timed[j];
      result.push({ text: words[i] ?? "", startMs: t?.startMs ?? 0, endMs: t?.endMs ?? 0 });
      i++;
      continue;
    }
    let k = i;
    while (k < n && match[k] === undefined) k++;
    const before = result[result.length - 1]?.endMs ?? timed[0]?.startMs ?? 0;
    const afterIndex = k < n ? match[k] : undefined;
    const after = afterIndex === undefined ? (timed[m - 1]?.endMs ?? before) : (timed[afterIndex]?.startMs ?? before);
    const span = Math.max(after - before, 0);
    const count = k - i;
    for (let q = 0; q < count; q++) {
      const startMs = Math.round(before + (span * q) / count);
      const endMs = Math.max(startMs + 1, Math.round(before + (span * (q + 1)) / count));
      result.push({ text: words[i + q] ?? "", startMs, endMs });
    }
    i = k;
  }
  return result;
};
