/**
 * What the product calls itself, in one place.
 *
 * Unbranded on purpose, for now. "Life Advice" is a TEMPLATE id — the first
 * kind of film this engine makes — and using it as the product's name would be
 * wrong the day a second kind exists. Naming and voice are the owner's to
 * decide; the pages are built so that decision is this constant and nothing
 * else.
 *
 * Everything here is deliberately plain rather than persuasive. A stranger
 * should understand what the thing is; selling it is a different page that
 * does not exist yet.
 */
export const PRODUCT_NAME = "Films";

/**
 * The heading on the only page that introduces itself.
 *
 * A description rather than a slogan, and that is the point: it says what the
 * thing does without pretending to a voice nobody has chosen. It also means the
 * home page does not depend on `PRODUCT_NAME` being any good.
 */
export const PRODUCT_BLURB = "A short film about someone you love";

export const PRODUCT_SUB =
  "You record an interview on your phone, add a few photographs, and we cut it " +
  "into a short documentary you can keep.";

/**
 * What actually happens, in the order it happens.
 *
 * Three steps because there are three: answer the questions, add the
 * photographs, and we cut it. Somebody deciding whether to start deserves to
 * know what they are agreeing to before they agree to it — particularly that
 * they will need the person in front of them.
 */
export const HOW_IT_WORKS: readonly { readonly title: string; readonly body: string }[] = [
  {
    title: "Sit down together",
    body:
      "We ask the questions, one at a time, and you record the answers on the " +
      "phone in your hand. About twenty minutes, and you can stop and come " +
      "back whenever you like.",
  },
  {
    title: "Add a few photographs",
    body:
      "Three or four pictures from different parts of their life, and a couple " +
      "of short clips if you have them. These are what turn an interview into " +
      "a film.",
  },
  {
    title: "We cut it, you keep it",
    body:
      "Every answer is transcribed and edited into a short film with music and " +
      "captions. You watch it before anybody else does, and download it to keep.",
  },
];
