import type { EDL } from "@film/edl";
import type { Template } from "@film/templates";

/**
 * What an editor is given, and what it gives back.
 *
 * The same for every film type: what was recorded, as ingest and
 * transcription measured it, and the template that says what the film is.
 * Every editor takes this and returns an edit decision list — the one
 * document the preview, the render and approval all work from — so an editor
 * can change without anything downstream noticing.
 */

/** Where somebody was speaking in a take, as ingest measured it from the
 *  waveform. Milliseconds from the start of the ingested file. */
export type SpeechRun = { readonly startMs: number; readonly endMs: number };

/** One word as transcription heard it: its text, and when in the take.
 *  Milliseconds from the start of the ingested file. */
export type TimedWord = { readonly text: string; readonly startMs: number; readonly endMs: number };

/** Everything ingest learned about one recorded answer. */
export type IngestedAnswer = {
  readonly questionId: string;
  readonly assetId: string;
  readonly durationMs: number;
  /** Measured speech, relative to the ingested file. */
  readonly runs: readonly SpeechRun[];
  readonly spoken: string;
  /**
   * `spoken`, word by word, with whisper's times. Absent where the words were
   * typed rather than transcribed, or transcribed before times were kept;
   * editors fall back to spreading the words across the measured speech.
   */
  readonly words?: readonly TimedWord[];
  /** Present on the answer that also supplies the cold open. */
  readonly coldOpen?: string;
  readonly emphasis?: { readonly phrase: string; readonly tone: "funny" | "meaningful" | "surprising" };
};

export type StillAsset = { readonly assetId: string; readonly slotId: string };

export type ComposeInput = {
  readonly projectId: string;
  readonly template: Template;
  readonly answers: readonly IngestedAnswer[];
  readonly stills: readonly StillAsset[];
  readonly brollAssetIds: Readonly<Record<string, string>>;
  /** assetId -> full duration, so a hold knows how much source is left. */
  readonly assetDurationMs: Readonly<Record<string, number>>;
  readonly track: {
    readonly id: string;
    readonly beatGridMs: readonly number[];
    readonly cues: { readonly titleMs: number };
  };
  readonly promptQuestionIds: readonly string[];
};

/** The cut, and notes on it for the log: what was skipped, and why. */
export type ComposeResult = {
  readonly edl: EDL;
  readonly notes: string[];
};
