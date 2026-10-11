/**
 * What the product calls itself, in one place.
 *
 * "Porch" is the working name that came with the brand direction the owner
 * chose on 2026-10-11. It is not cleared yet — it needs a trademark and domain
 * check — which is why it lives here and only here. "Life Advice" is a
 * TEMPLATE id, the first kind of film this engine makes, and must never be
 * used as the product's name.
 *
 * Everything here is deliberately plain rather than persuasive. A stranger
 * should understand what the thing is; selling it is a different page that
 * does not exist yet.
 */
export const PRODUCT_NAME = "porch";

/** The brand line, from the Porch direction. */
export const PRODUCT_LINE = "Sit down together. Leave with a film.";

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

/**
 * What somebody deciding whether to start actually asks, answered plainly.
 *
 * Every answer here has to be true of the product as built — no promise of an
 * email that is never sent, no price that does not exist. When the product
 * changes, these change with it.
 */
export const FAQ: readonly { readonly q: string; readonly a: string }[] = [
  {
    q: "How long does it take?",
    a:
      "About twenty minutes with the person you are filming, and a few more to " +
      "add photographs. You can stop at any point and pick up later — everything " +
      "is saved as you go.",
  },
  {
    q: "Do I need an account?",
    a:
      "Not to start. When you are ready to make the film we ask for your email, so " +
      "that the finished film is yours and only yours.",
  },
  {
    q: "Can I use photos and videos I already have?",
    a:
      "Yes. Every step lets you record or take a photo there and then, or upload " +
      "something from your phone or computer.",
  },
  {
    q: "What do I get?",
    a:
      "A film you can download and keep — an MP4 that plays on phones, televisions " +
      "and computers. You watch it first, and nothing is final until you approve it.",
  },
  {
    q: "Who can see it?",
    a:
      "Only you. Your film is kept behind your email address, and nobody else can " +
      "open it.",
  },
  {
    q: "What if something goes wrong?",
    a:
      "Nothing you record is lost. If a film cannot be finished, every recording " +
      "stays exactly where it was and the film can be made again.",
  },
];
