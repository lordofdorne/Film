import { z } from "zod";
import { Id, MsInt, MsPositive } from "./primitives.js";
import { QuestionPromptSegmentSchema } from "./prompt.js";
import { SpeechSegmentSchema } from "./speech.js";
import { VisualSegmentSchema } from "./visual.js";

export const EdlAudioSchema = z
  .object({
    musicTrackId: Id,
    /** Offset INTO the track played at timeline 0. A cue at track time C
     *  therefore appears at timeline time C - musicStartMs. */
    musicStartMs: MsInt,
    musicGainDb: z.number().min(-60).max(0),
    /** Additional attenuation applied while speech is present. */
    duckDb: z.number().min(-30).max(0),
    /** Frozen copy of the selected track's downbeats, so a render stays
     *  reproducible even if the registry's measurement is later corrected.
     *  The validator rejects divergence from the resolved track. */
    beatGridMs: z.array(MsInt),
    /**
     * Music edits: at timeline `atMs`, the track continues from `toMs`,
     * crossfaded over `crossfadeMs` centred on the edit. Forward skips a
     * section, backward repeats one — how a film's music is made to end with
     * the film without changing where it starts. Absent: the track plays
     * straight through from `musicStartMs`, as every EDL before Phase 9 did.
     */
    musicEdits: z
      .array(
        z
          .object({ atMs: MsInt, toMs: MsInt, crossfadeMs: MsPositive })
          .strict(),
      )
      .optional(),
  })
  .strict();

/** Where in the track the music is at timeline `ms`, edits included. */
export const trackTimeAt = (
  audio: { readonly musicStartMs: number; readonly musicEdits?: readonly { readonly atMs: number; readonly toMs: number }[] | undefined },
  ms: number,
): number => {
  let start = 0;
  let trackAtStart = audio.musicStartMs;
  for (const edit of audio.musicEdits ?? []) {
    if (edit.atMs > ms) break;
    start = edit.atMs;
    trackAtStart = edit.toMs;
  }
  return trackAtStart + (ms - start);
};

/**
 * The edit is a versioned JSON document, not application code.
 *
 * `templateId` is a plain Id rather than a literal union: the engine must not
 * know which templates exist, or a second template becomes an engine change.
 * Template identity is checked against injected conformance data instead.
 *
 * Asset URLs never appear here — only stable asset ids, resolved to signed
 * URLs immediately before preview or render.
 */
export const EdlSchema = z
  .object({
    version: z.literal("1.0"),
    projectId: Id,
    templateId: Id,
    templateVersion: z.number().int().positive(),
    fps: z.literal(30),
    totalDurationMs: MsPositive,
    audio: EdlAudioSchema,
    visualSegments: z.array(VisualSegmentSchema).min(1),
    /** Questions shown over picture, with optional off-screen interviewer audio. */
    promptSegments: z.array(QuestionPromptSegmentSchema),
    speechSegments: z.array(SpeechSegmentSchema).min(1),
  })
  .strict();

export type EdlAudio = z.infer<typeof EdlAudioSchema>;
export type EDL = z.infer<typeof EdlSchema>;
