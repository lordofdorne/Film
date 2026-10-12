# Phase 9 — An editor per film: shaping what people give us

**Status: audited 2026-10-12, waiting on the owner's approval.**

## What was asked

> We need to look into how the film adjusts. When one person captures an
> answer the length is different from another. That is the bread and butter
> of this platform: it takes people's [recordings] and molds it into a
> beautiful film. This is not one-size-fits-all, because different films will
> have different [material] and templates as we scale, so each one needs its
> own service.

## How the film adjusts today

The edit is made by `composeFilm` in `packages/pipeline/src/compose/plan.ts`,
about 1,000 lines. Read end to end, it does three things to fit what somebody
recorded:

1. **One dial for the whole film.** It adds up how long the person spoke across
   every answer and turns that into a single number, `fit`, between the
   template's `lean` (90 s of speech) and `rich` (180 s). Photo holds, b-roll and
   the opening all stretch with it: brisk when little was said, breathing when a
   lot was.
2. **Inserts that depend on the answer's length.** A photo or clip is cut into
   an answer only if the answer is long enough to show the person for 2 s
   first and return to them before the end.
3. **Careful edges.** Each answer starts a moment before the first word and ends
   a moment after the last, never past the end of the take.

That is good craft, and it is all kept. What it does **not** do:

| Gap | What it means for a real film |
|---|---|
| **Every answer is used whole**, first word to last, every pause inside it kept. | A six-minute ramble is six minutes of film. A grandmother who talks for twenty minutes gets a twenty-minute film. |
| **The template's target length is never read.** Life-advice declares 3½–4 minutes (`targetDurationMs`); nothing in compose looks at it. | Film length is simply "however long they talked", plus titles. |
| **No balance between answers.** Ten seconds on love and four minutes on longevity are both used as recorded. | The film's shape is decided by which question happened to set them off, not by the template's idea of the film. |
| **The music never adapts.** One 4-minute track, always from the start, faded out wherever the film stops. | A long film runs out of music; a short one ends mid-phrase instead of on the track's ending. |
| **Word timings are estimated, not measured.** Whisper's word timestamps are switched off; captions spread words across measured speech. | Fine for captions, but no edit can safely cut *between sentences*, which is exactly what shortening an answer needs. |

### And it is life-advice only

The template already *describes* its film: `structure` (the order of the
moments), `beatSources` (which question or photo feeds each one),
`targetDurationMs`, an `editing` grammar. **Compose reads almost none of it.**
The order of the film, ten question ids and eight photo/clip slots
(`greatest_lesson`, `photo_group`, `keepsake`, …) are hard-coded in the
pipeline. A second template would fail on its first film with
`no ingested answer for question "longevity"`, and the only way to make one
would be to copy the thousand lines and edit them.

So the owner's instinct is right, and the code confirms it: the part that
*makes* the film is the one part that is not yet per-template.

## The proposal

### 1. An editor per template

Each template names its editor, and the editor is its own module behind one
small, fixed interface:

```
material in  →  editor  →  edit decision list (EDL) out
(what was recorded,        (the same validated document
 measured and transcribed)  the preview and the render use)
```

- **`@film/editors`**, a new package. `lifeAdvice` is the first editor, and it
  starts as **today's `composeFilm`, moved and not changed**: every existing
  film must compose to the byte-identical EDL, checked by a test over the
  fixture and real projects. Only then does it start to change.
- **A shared toolkit** for what every editor needs and nobody should rewrite:
  the timeline that keeps cuts contiguous, safe source windows, question
  cards, inserts that respect "on the person first", caption layout. Editors
  differ in judgement, not in plumbing.
- **The pipeline stops knowing about life-advice.** The compose stage gathers
  the material, asks the template's editor, validates, stores. Validation stays
  where it is, so no editor can produce a film the renderer can't play.
- **Versioned like templates.** An editor change bumps its version, which is in
  the compose hash, so films re-cut exactly when their editor changes and never
  otherwise.

"Its own service", concretely: its own module, its own tests, its own version
and its own golden films. It runs inside the worker for now, because an edit
takes milliseconds. If an editor ever needs something heavy (a model choosing
the best take, say), the same interface can move it to its own queue without
touching the others.

### 2. The life-advice editor learns to shape

In order of value, each one tested against short, average and very long real
recordings:

1. **A length budget.** The film aims at the template's target, and each
   moment gets a share the template declares (the greatest lesson matters more
   than the birth year). A short film stays short and good; a long recording is
   *shaped* to fit, never padded.
2. **Tighten before cutting.** Long pauses inside an answer are shortened to a
   natural breath first. That alone often brings a long answer in without
   losing a word.
3. **Choose, don't chop.** When an answer is still over its share, the editor
   keeps whole sentences, in order, preferring the ones that carry the point
   (the emphasis phrase, complete thoughts) and dropping restarts and asides.
   Never mid-sentence, never mid-word. This needs **real word timings**, so
   whisper's timestamps are switched on for this; captions get more accurate as
   a side effect.
4. **Music that ends with the film.** The music is placed so its ending lands
   on the end title, whatever the film's length: start later into the track for
   a short film, extend with the track's own loop section for a long one. Music
   tracks gain a declared loop region and ending.
5. **Notes the customer can read.** "We used about two minutes of your four
   on longevity, the parts about…": shown beside the preview, so shortening is
   never a surprise. (The edit stays theirs to judge; "use the whole answer"
   becomes possible once "request a change" exists.)

### 3. Proof

- Golden films: the fixture plus three real projects (short, average, long
  talker), each with its EDL checked in and its length, per-answer share and
  music ending asserted.
- The byte-identical check for step 1, before any behaviour changes.

## Blocks

| # | Block | Changes a film? |
|---|---|---|
| 1 | `@film/editors` and the toolkit; life-advice moved with **identical** output; pipeline made template-agnostic | No, and proven |
| 2 | Real word timings from whisper; a sentence model on each answer | Captions slightly more accurate |
| 3 | Length budget, pause tightening, sentence choice | Yes: long recordings get shaped |
| 4 | Music that ends with the film | Yes |
| 5 | The customer's notes on what was shaped | Preview page |

## Fitting it with Phase 8

Phase 8 (performance) and this touch different code: Phase 8 is the web app,
the camera, the player and the render; this is compose. They can run side by
side, but each block is still a PR and a stop. Phase 8's Block 4 (render while
they watch) gets *more* valuable here: a shaped film is a film people approve
first time.

## Owed by the owner

- **Approve the direction**, especially "a long recording is shaped to the
  template's length" (today: never shortened).
- **The shares**: how much of the film each life-advice moment should get.
  I'll propose numbers from the template's own intent for you to adjust.
- **Music**: the real tracks will need a loop region and an ending marked,
  which the composer or licensor can supply.
