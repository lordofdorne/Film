import type { Template } from "@film/templates";

import type { Editor } from "./editor.js";
import { LIFE_ADVICE_EDITOR } from "./life-advice/index.js";

export type { Editor } from "./editor.js";
export * from "./material.js";
export { openingWords } from "./toolkit.js";
export { alignToRuns, captionsWithin, phrasesOf, PHRASE_PAUSE_MS, timedWordsOf, type Phrase } from "./words.js";

/**
 * Every editor, by the id a template names.
 *
 * A map rather than a switch so adding one is one line here and a module
 * beside it, and the test over every template can check each one resolves.
 */
const EDITORS: Readonly<Record<string, Editor>> = {
  [LIFE_ADVICE_EDITOR.id]: LIFE_ADVICE_EDITOR,
};

/** The editor a template's films are cut by. A template naming one that does
 *  not exist is a programming error, found by the test over every template. */
export const editorFor = (template: Pick<Template, "id" | "version" | "editor">): Editor => {
  const editor = EDITORS[template.editor];
  if (editor === undefined) {
    throw new Error(
      `${template.id}@${String(template.version)} names editor "${template.editor}", which does not exist`,
    );
  }
  return editor;
};
