import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";
import { isPlayer } from "./assets/resolveSrc.js";

/**
 * A pinned font, registered from a data URI.
 *
 * Two things here matter more than they look.
 *
 * First, this is a vendored file rather than a system stack. "-apple-system"
 * resolves to different glyphs on a developer's Mac and in the Linux render
 * container, so every golden frame containing text would fail on one machine
 * or the other. A pinned file makes text deterministic.
 *
 * Second, the family is registered under the TEMPLATE's name, not the
 * vendor's. Swapping Inter for a commissioned typeface when brand identity
 * lands is then a change here and nowhere else, and the template config never
 * mentions a font vendor.
 *
 * There is deliberately no delayRender() gate. The obvious implementation —
 * delayRender at module scope, continueRender once FontFace.load() resolves —
 * is subtly broken: a handle created outside a React render pass is never
 * reconciled against Remotion's per-render bookkeeping, so the watchdog counts
 * it as outstanding no matter how promptly continueRender runs. It then kills
 * the render at the timeout boundary, having rendered a thousand perfectly
 * good frames. Measured directly: the gate opened and closed within 2s and the
 * render still died at exactly the deadline.
 *
 * The gate is not needed anyway. webpack inlines this .woff2 as a data URI
 * (see scripts/webpack-override.ts), so there is no fetch to await — the face
 * is decodable the moment the stylesheet is parsed, which happens during
 * module evaluation, before React mounts. `font-display: block` closes the
 * remaining gap: text stays invisible rather than falling back to a system
 * face, so the failure mode is a caught-in-review blank frame rather than a
 * silently wrong typeface.
 *
 * assertFontReady() below turns any residual risk into a loud error.
 */
export const FONT_FAMILY = "LifeAdviceSans";

const FACE_RULE = `
@font-face {
  font-family: "${FONT_FAMILY}";
  src: url(${interWoff2}) format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: block;
}`;

let registered = false;

export const registerFont = (): void => {
  if (registered || typeof document === "undefined") return;
  registered = true;

  const style = document.createElement("style");
  style.setAttribute("data-font", FONT_FAMILY);
  style.textContent = FACE_RULE;
  document.head.appendChild(style);

  // Fire-and-forget: prompts Chrome to decode the face immediately rather than
  // lazily at first use. Nothing awaits it, so nothing can hang on it.
  void document.fonts.load(`1em "${FONT_FAMILY}"`);
};

/**
 * Fails a RENDER loudly if the family did not register, so a film is never
 * shipped with letterforms that silently differ from every golden frame.
 *
 * Deliberately not fatal in the Player. There, the font arrives over the
 * network like any other asset and the first paint legitimately happens before
 * it lands — throwing would turn a normal 100ms of loading into a crashed
 * preview. The stakes differ too: a preview frame in a fallback face is
 * momentary and self-correcting, while a delivered file is permanent.
 */
export const assertFontReady = (): void => {
  if (typeof document === "undefined") return;
  if (document.fonts.check(`1em "${FONT_FAMILY}"`)) return;

  if (isPlayer()) {
    // Nudge the load along and let this frame paint in whatever is available.
    void document.fonts.load(`1em "${FONT_FAMILY}"`);
    return;
  }

  throw new Error(
    `${FONT_FAMILY} is not available; text would render in a fallback face. ` +
      "Check that the .woff2 import resolved to a data URI.",
  );
};
