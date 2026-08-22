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
 * What is deliberately NOT used: word-level timestamps. whisper.cpp can emit
 * them, and it would be the obvious thing to reach for — but the film's
 * captions are laid out by `distributeWords` against the speech runs that
 * INGEST measured from the waveform, which are more reliable than a model's
 * guesses and already exist. All that is wanted here is the words.
 */

export type Transcript = {
  readonly text: string;
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
 * `--no-timestamps` because of the note above, and because it makes the output
 * file a plain paragraph rather than something to parse. The transcript is
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

  try {
    await run(BIN(), args, {
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

  const raw = await readFile(txt, "utf8").catch(() => "");
  await rm(txt, { force: true });

  return {
    // Whisper pads with newlines and leading spaces between segments; the
    // film's caption layout counts words, so collapse it to one paragraph.
    text: raw.replace(/\s+/g, " ").trim(),
    engine: "whisper.cpp",
    model: model.split("/").pop() ?? model,
    language: LANGUAGE(),
  };
};
