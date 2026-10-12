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
   */
  version: 5,
  edit: editLifeAdvice,
};
