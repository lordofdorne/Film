import type { Editor } from "../editor.js";
import { editLifeAdvice } from "./edit.js";

export const LIFE_ADVICE_EDITOR: Editor = {
  id: "life-advice",
  /**
   * Bump when this editor's cut changes for the same inputs.
   *
   * Starts at 4 because it IS the pipeline's old COMPOSE_RECIPE, carried over:
   * the compose stage hashes this number under the same key, so moving the
   * editor into its own package changed no film's hash and re-cut nothing.
   * The history of 2, 3 and 4 is in packages/pipeline/src/stages/compose.ts.
   *
   * 5: captions from timed words where transcription kept them (Phase 9,
   * Block 2). Answers without timed words are cut exactly as by 4 — every
   * existing film, since transcription never overwrites words it already
   * wrote — so re-composing them yields the same cut and no new version.
   *
   * 6: answers over their share of the film are shaped to fit (Phase 9,
   * Block 3) — long pauses out, then the strongest whole sentences. Only
   * answers with word times can be shaped, so again every film made before
   * is cut exactly as by 5. When the optional bonus answer is given, every
   * share shrinks so the film is no longer for it (`sharesFor`).
   *
   * 7: the music ends with the film (Phase 9, Block 4): a music edit on a
   * downbeat lands the track's ending cue on the end title, and the black
   * hold before it takes up what a bar line cannot. Only for tracks with a
   * beat grid and an ending marked; the temp beds every film uses so far have
   * neither, so those films are cut exactly as by 6.
   */
  version: 7,
  edit: editLifeAdvice,
};
