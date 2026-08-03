import type { EDL } from "../schema/edl.js";
import type { SpeechSegment } from "../schema/speech.js";
import { endOf, type InterviewSegment } from "../schema/visual.js";
import { LIP_SYNC_TOLERANCE_MS } from "./context.js";
import type { IssueCollector } from "./issues.js";

/** Where in the source file a segment is reading at timeline position t. */
const sourceAt = (
  s: { startMs: number; sourceInMs: number },
  t: number,
): number => s.sourceInMs + (t - s.startMs);

const overlaps = (a1: number, a2: number, b1: number, b2: number): boolean =>
  Math.max(a1, b1) < Math.min(a2, b2);

/**
 * The two invariants that only exist because the EDL has independent visual
 * and speech timelines. Both tracks can name the same asset, which is the
 * whole point — and also the most likely way to produce a film that is subtly,
 * expensively wrong.
 */
export const checkCrossTrack = (edl: EDL, c: IssueCollector): void => {
  const interviews = edl.visualSegments.filter(
    (s): s is InterviewSegment => s.kind === "interview",
  );

  edl.speechSegments.forEach((sp, i) => {
    const path = `speechSegments[${i}]`;
    const spEnd = endOf(sp);

    for (const v of interviews) {
      const vEnd = endOf(v);
      if (!overlaps(sp.startMs, spEnd, v.startMs, vEnd)) continue;

      // A speech segment may run beneath photo, broll, title or black freely.
      // What it must never do is play under a DIFFERENT person's talking head.
      if (v.assetId !== sp.assetId) {
        c.error(
          "SPEAKER_COLLISION",
          `${path}.startMs`,
          `speech from "${sp.assetId}" plays under interview segment "${v.id}", ` +
            `which shows "${v.assetId}"`,
        );
        continue;
      }

      // Same asset on both tracks: the mouth on screen and the voice must be
      // reading the same moment of the same file. Both advance at 1:1, so
      // agreement at the overlap boundaries implies agreement throughout.
      const lo = Math.max(sp.startMs, v.startMs);
      const hi = Math.min(spEnd, vEnd);
      for (const t of [lo, hi]) {
        const drift = Math.abs(sourceAt(v, t) - sourceAt(sp, t));
        if (drift > LIP_SYNC_TOLERANCE_MS) {
          c.error(
            "LIP_SYNC_DRIFT",
            `${path}.sourceInMs`,
            `at timeline ${t}ms, visual "${v.id}" reads source ${sourceAt(v, t)}ms ` +
              `but speech "${sp.id}" reads ${sourceAt(sp, t)}ms — ${drift}ms apart ` +
              `(tolerance ${LIP_SYNC_TOLERANCE_MS}ms)`,
          );
          break;
        }
      }
    }
  });
};

export const impliedSourceAt = sourceAt;
export type { SpeechSegment };
