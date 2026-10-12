import type { ComposeInput, ComposeResult } from "./material.js";

/**
 * One film type's editor: what was recorded in, the cut out.
 *
 * Every template names its editor, and every editor has this shape and no
 * other — so the compose stage, the preview, the render and approval never
 * learn which film they are handling. A new film type is a new template and,
 * when its films are not cut the way an existing one's are, a new editor.
 *
 * Pure: the same material gives the same cut, byte for byte. That is what
 * makes compose's input hash mean anything and a retry free.
 */
export type Editor = {
  readonly id: string;
  /** Bump when the cut changes for the same inputs; it is in compose's hash. */
  readonly version: number;
  readonly edit: (input: ComposeInput) => ComposeResult;
};
