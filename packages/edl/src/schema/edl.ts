import { z } from "zod";
import { Id, MsInt, MsPositive } from "./primitives.js";
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
  })
  .strict();

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
    speechSegments: z.array(SpeechSegmentSchema).min(1),
  })
  .strict();

export type EdlAudio = z.infer<typeof EdlAudioSchema>;
export type EDL = z.infer<typeof EdlSchema>;
