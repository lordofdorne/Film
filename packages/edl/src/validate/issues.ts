import type { EDL } from "../schema/edl.js";

export type Severity = "error" | "warning";

export type Issue = {
  readonly code: IssueCode;
  readonly severity: Severity;
  /** Dotted path into the EDL, e.g. "visualSegments[12].sourceOutMs". */
  readonly path: string;
  readonly message: string;
};

/**
 * Every rule has a stable code. Tests assert on codes, not message text, so
 * wording can improve without breaking the suite — and so the approval UI can
 * map a code to customer-facing copy without parsing English.
 */
export const ISSUE_CODES = [
  // schema / general
  "SCHEMA_INVALID",
  "DUPLICATE_SEGMENT_ID",
  "UNKNOWN_ASSET",
  "ASSET_KIND_MISMATCH",
  "ASSET_SLOT_MISMATCH",
  "ASSET_QUESTION_MISMATCH",
  "FPS_FORMAT_MISMATCH",
  "TEMPLATE_MISMATCH",
  "SEGMENT_TOO_SHORT",
  "TIME_NOT_FRAME_ALIGNED",
  "OVERLAY_TEXT_COLLISION",

  // visual timeline
  "VISUAL_NOT_SORTED",
  "VISUAL_FIRST_HAS_TRANSITION",
  "VISUAL_CONTIGUITY_BROKEN",
  "VISUAL_TRANSITION_TOO_LONG",
  "VISUAL_DOES_NOT_END_AT_TOTAL",
  "SOURCE_SPAN_MISMATCH",
  "SOURCE_RANGE_OUTSIDE_ASSET",
  "INTERVIEW_SCALE_UNSUPPORTED",

  // speech timeline
  "SPEECH_NOT_SORTED",
  "SPEECH_OVERLAP",
  "SPEECH_OUTSIDE_TIMELINE",
  "CAPTION_OUT_OF_BOUNDS",
  "CAPTION_NOT_SORTED",
  "EMPHASIS_OUT_OF_RANGE",

  // cross-track
  "LIP_SYNC_DRIFT",
  "SPEAKER_COLLISION",

  // music
  "MUSIC_TRACK_UNRESOLVED",
  "MUSIC_TRACK_UNLICENSED",
  "MUSIC_TRACK_TOO_SHORT",
  "MUSIC_CUE_OUTSIDE_TRACK",
  "BEAT_GRID_DIVERGENCE",

  // template conformance
  "TOO_MANY_EMPHASIS",
  "TOO_MANY_CONSECUTIVE_PHOTOS",
  "REQUIRED_SLOT_MISSING",
  "UNKNOWN_QUESTION_ID",
  "DURATION_OUTSIDE_TARGET",
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

export class IssueCollector {
  readonly #issues: Issue[] = [];

  error(code: IssueCode, path: string, message: string): void {
    this.#issues.push({ code, severity: "error", path, message });
  }

  warn(code: IssueCode, path: string, message: string): void {
    this.#issues.push({ code, severity: "warning", path, message });
  }

  get errors(): Issue[] {
    return this.#issues.filter((i) => i.severity === "error");
  }

  get warnings(): Issue[] {
    return this.#issues.filter((i) => i.severity === "warning");
  }

  get hasErrors(): boolean {
    return this.#issues.some((i) => i.severity === "error");
  }
}

export type ValidationResult =
  | { readonly ok: true; readonly edl: EDL; readonly warnings: Issue[] }
  | { readonly ok: false; readonly errors: Issue[]; readonly warnings: Issue[] };

export const formatIssue = (i: Issue): string =>
  `${i.severity.toUpperCase()} ${i.code} at ${i.path}: ${i.message}`;
