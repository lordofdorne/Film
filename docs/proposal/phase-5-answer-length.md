# Phase 5 — Films the length of what people said

**Status:** 2026-08-24 · **both halves are built.** The film adapts to its
material, and the hub says how much has been said while there is still time to
say more.

## Built: the film adapts to its material

The owner's answer to the problem below was the better one — *"we can't expect
users to have the same length"* — so the fix is that the system stops assuming
one.

Every range in `editing` (`photoHoldMs` 3–5s, `brollMs` 2–6s,
`openingContextMs` 2–5s) was read as its minimum and nothing else. The
template declared elasticity that compose never used, so a film built from
twenty minutes of wonderful answers was cut exactly as tightly as one built
from ninety seconds.

`editing.adaptiveSpeechMs: { lean, rich }` now turns "how much did they
actually say" into how much room the pictures get. One factor, measured before
any beat is laid out, applied to every declared range — so the film is
proportionate to itself rather than to a target somebody else's footage
suggested.

Measured, same template, same slots, only the answers changing:

| answers | film | speech | structure |
|---|---|---|---|
| 10s each | 2:06 | 85s | 41s |
| 20s each | 3:44 | 185s | 39s |
| 35s each | 6:03 | 335s | 29s |

**It does not stretch a short film to look like a long one.** Padding thin
material with slow photographs makes it feel thin *and* slow. A two-minute
film should be a good two-minute film.

`DURATION_OUTSIDE_TARGET` was also rewritten, because it was blaming customers
for being brief. It now warns when a film runs LONG — the material was there
and the edit did not shape it — and when a film runs short *despite* there
having been enough speech to reach the target, which is the only short film
the edit can honestly be blamed for. A film that is short because the answers
were short is a shorter film, not a defect.

The owner's own film: **1:58, valid, no warning.**

---

## Built: saying it while they can still say more

Two signals, neither needing a number anybody invented.

**Per card**, an answer is judged against THIS PERSON's other answers, not
against a target. Somebody whose every answer is eight seconds is having a
short-answer conversation and is left alone; somebody who has been giving
thirty-second answers and then gives four has probably been interrupted, and
would want to know. Below three seconds it always speaks, because that is not
an answer.

The rule lives in `@film/pipeline` (`spokenVerdict`) where it is tested; only
the wording is in the web app.

**On the hub**, "37 seconds of answers recorded" — the total, growing as takes
land. One short answer is nothing; five is a two-minute film, and this is what
makes that visible while it can still be changed.

**Length outranks the picture**, for short and inaudible takes only. There is
room for one sentence on a card: a four-second answer told "this looks a little
soft on a big screen" has been given the less useful of two true things. Found
by watching a real card show the wrong note.

### What was rejected

The obvious design was a per-question `spokenSeconds: { short, good }` in the
template. Deriving those from `estimatedSeconds` gives `identity_name` a
thirteen-second expectation — that field is CAPTURE time, including setup and
a retake, not answer length — and nagging somebody about a perfectly good
four-second answer to "What is your name?" would be worse than a short film.
Relative-to-the-person needs no such numbers and cannot make that mistake.

### The original proposal, for the record

## The problem, in the owner's own footage

The first film captured entirely in the browser came out **1:59** against a
template target of 3:30–3:50. Its ten answers were:

```
 4s  identity_age          11s  love_lesson
 4s  identity_name         12s  meaning_of_group
 5s  identity_birth_year   16s  greatest_lesson
 5s  bonus_interviewer     20s  advice_for_young_people
10s  closing_message       11s  longevity
```

**98 seconds of speech.** The film was 119s: the answers, plus about 21s of
structure.

The template's 210–230s target implies roughly **17 seconds an answer**. The
average here was 9.8, and four answers were under six seconds.

## What cannot fix it

**Editing cannot.** A film's length is essentially the sum of what people say,
and there is no cut that rescues a four-second answer. The template declares
ranges everywhere — `photoHoldMs` 3–5s, `brollMs` 2–6s, `openingContextMs`
2–5s — and compose currently takes the minimum every time. Fitting every beat
to its maximum is worth having and buys **12–15 seconds**. Against a 90-second
gap it is rounding error.

Two things are already right and should not be touched:

- **The music bed loops to length** (`buildLoopedBed`), so it fits any film.
- **`DURATION_OUTSIDE_TARGET` never reaches the customer.** It is a validator
  warning in the log; `loadProjectForPreview` only surfaces per-asset QC.
  Nobody is ever shown "your film is outside the target range", which would be
  a horrible sentence to read about a film of your grandmother.

## What can

**Say it during capture, while the person is still in the room.**

A four-second answer is knowable the moment it is recorded. Ingest already
measures it — `speechRuns` on every take, within seconds, because Block 7 put
ingest inside capture for exactly this reason. The hub already shows a QC note
per card in the customer's language. Everything needed is present; nothing
currently looks at length.

After capture it is unfixable, and the person has gone home.

---

## What to build

### 1. The template says what a good answer looks like

The threshold is content, not code — the same rule that put `estimatedSeconds`
and every piece of coaching copy in `@film/templates`. "How long should this
answer be" is a question about *this* film type, and `apps/web` must contain no
string or number that only makes sense for life-advice.

`Question` gains one field beside `estimatedSeconds`:

```ts
/** How long an answer wants to be to cut well. Content, not code: too short
 *  and the film is thin, and only the template knows what this question is
 *  worth. */
readonly spokenSeconds: { readonly short: number; readonly good: number };
```

For `life-advice@1`: the identity questions are genuinely brief — "What is
your name?" is not a 30-second answer — so `identity_name` might be
`{ short: 2, good: 6 }` while `greatest_lesson` is `{ short: 8, good: 30 }`.
**Getting these numbers right is the owner's call, not mine.** They are the
difference between useful encouragement and nagging somebody about a question
that only needed four seconds.

`validateTemplate` should check `short < good`.

### 2. The card says so, kindly, with the fix one press away

`qcNoteOf` in `apps/web/src/server/capture.ts` already turns measurements into
sentences. It gains a length branch, below the existing warnings:

- under `short` → *"That one was four seconds. If there is more to say, another
  go would give the film more to work with."*
- at or over `good` → the existing *"We could hear this clearly."*

The wording stays generic to any film — it talks about length and sound, never
about grandmothers — which is what keeps it allowed in `apps/web` at all,
exactly like `LOW_RESOLUTION`.

**Tone is the whole risk here.** "Never feeling trapped" is one of the four
things the owner said this must feel like. The note is an observation with an
easy action beside it, never a warning, never a red mark, and never a blocker:
a short answer is still a finished card, the film still makes, and nobody is
stopped. If it reads as a scold on the screen, it is wrong and should be cut
back to nothing.

### 3. The hub says how the film is shaping up

The header currently says *"4 of 22 done · about 20 minutes left"* — that is
time left to *record*. Beside it, once anything is ingested:

> **about 2 minutes of answers so far**

Deliberately "of answers", not "your film will be N minutes". Predicting the
finished length means modelling the edit, and a number that turns out wrong on
the preview screen is worse than no number. If the owner would rather promise
a film length, the template must also declare the structural seconds it adds,
and that is a second decision.

This is the number that makes the per-card notes add up to something. One
short answer is nothing; five is a two-minute film.

### 4. Nothing changes about what is required

Short answers do not block "Make my film", do not fail compose, and do not
mark a card incomplete. `captureReadiness` is untouched. This is
encouragement, not a gate — a person who wants a two-minute film should get a
two-minute film without arguing with us about it.

---

## What this does not do

It will not save a film that has already been captured, and it will not make
anybody talk for longer who does not want to. It moves the moment of discovery
from "hours later, unfixable" to "now, while the camera is still up", which is
the only place the problem is solvable at all.

The other three levers stay on the table and are all cheaper after this one:

- **Coaching before recording** — the same numbers, said before the camera is
  up rather than after. Pure content.
- **An honest duration target** — 210–230s encodes an assumption about how much
  people say; it could be widened or derived from material.
- **Fit-to-duration in compose** — use the declared ranges instead of the
  minimums. Worth ~15s, and it makes the edit breathe. An editorial call.

## Open question for the owner

**The numbers in §1.** Everything else here is plumbing; those thresholds are
the product. What is a good answer to "What is your name?" and what is a good
answer to "What is the greatest lesson you have learned?" — and at what point
would you, personally, want to be told "go again"?
