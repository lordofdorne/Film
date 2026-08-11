# Phase 3 — Browser capture: design

**Status:** Proposed · 2026-08-10 · awaiting approval

Nothing here is built. This is the design to argue with before any of it is
written. It follows `docs/CHECKPOINT.md` § "The capture flow", which records
the requirements this has to satisfy.

---

## 1. What this is for

Today a film needs a terminal. Someone with the repository checked out puts
files in `incoming/`, types the spoken words of every answer into a JSON file,
and runs `pnpm intake`. Everything after that point works without a human:
ingest, compose, approve in a browser, render, deliver, download.

Capture is the missing front door. When it exists, a person with a phone and a
link can make a film. That is the whole gap between "the product works" and
"the product can be used by many people", which is the stated priority.

---

## 2. The requirements

From the owner, 2026-08-10, verbatim:

> The flow is supposed to feel like a walk-through. Users will capture their
> videos/photos, or choose to upload. We need to have space for text to give
> them inspiration so that we create the best film possible. For instance for
> the life advice the first photo upload should have a suggestion like "Add a
> photo of the person from another time".

Everything below is downstream of those four sentences.

---

## 3. What has to be true before this can ship

Four things stand between "the walk-through works" and "the walk-through
produces a film". They are not UI work, and none of them is visible from the
capture screens. I found them by reading the pipeline rather than by imagining
the flow, and they are the reason this document leads with them.

### 3.1 Every take needs its words, and nobody is going to type them

`compose` refuses an interview asset with no `selection.spoken`:

```
answer greatest_lesson has no usable text
```

It is a **permanent** failure — no retry helps. That text is typed by hand into
`incoming/project.json` today, once per answer, by whoever runs intake.

So a walk-through that records ten answers and nothing else produces ten
projects that ingest cleanly, reach compose, and die. There are only three ways
out, and two of them are bad:

1. **Ask the customer to type what was said, after each answer.** Ten times, on
   a phone, with an elderly relative sitting in front of them waiting. This
   would be the single worst screen in the product.
2. **Ship capture and let the projects fail.** Not shippable.
3. **Implement the `transcribe` stage.** Its queue, its enum value, its policy
   and its `assets.transcript_key` column all exist already; the worker
   deliberately does not register it because a stage that succeeds without
   doing anything is indistinguishable from one that works.

**Recommendation: (3), inside this block.** It is smaller than it sounds. One
stage, per interview asset, reading the normalised audio that ingest already
produced, calling a hosted speech-to-text API, writing the transcript object and
setting `selection.spoken` to the whole answer — which is exactly what a person
types into `project.json` today, so the shape downstream does not change at all.
Word-level timings and LLM range selection stay in Phase 4 where they belong.

This is the one decision that changes the size of the block, so it is decision
**D1** in § 13.

### 3.2 Every project needs a music bed, and it currently arrives as an upload

`createProject` refuses a project with no music bed, and ingest builds the bed
by cropping and looping an **uploaded audio asset**. That upload is a file in
`incoming/songs`. A customer is never going to supply one.

The fix is already anticipated by the schema: `MusicTrack.assetKey` is a nullable
storage key on every registry entry. An operator uploads each licensed track's
audio to the store once; finishing capture copies that object into the project's
own key and writes the music-bed asset row against it.

Copying rather than sharing keeps the project-scoping invariant literally true,
costs a few megabytes, and means **no change to ingest or compose at all**. The
track's crop points and crossfade — hand-typed per project today — move onto the
registry entry, which is where a property of the track belongs.

### 3.3 A project mid-capture must not be marked failed

`dispatchActiveProjects` marks a project `failed` when it has blocked work and
nothing else to do. That is right for a project in flight and wrong during
capture: one photograph that ingest permanently rejects, at a moment when it is
the only asset in the project, would fail the project **while the customer is
still standing there** — and they could simply have picked another photo.

The give-up rule must not apply to a `capturing` project. It is a condition on
one branch, and it is a data-loss bug if it is missed.

### 3.4 There is no page for "we are making your film"

Finishing capture puts the project in `processing`, and the preview page
(`/projects/[id]`) 404s until compose has written an EDL version — because
`loadProjectForPreview` returns null when there are no versions. So today the
walk-through would end by handing someone a Not Found.

`DeliveryPanel` already polls and already renders a "making your film" state.
What it needs is a page to live on before an EDL exists, which is a small
extension of the existing `loadDelivery`, not a new mechanism.

### 3.5 And the standing one: there is no auth

The project URL is the credential, exactly as it already is for approval and
download. Anyone with the link can add media to the project, approve its film,
and download it. This is a known, recorded gap (Phase 8), and capture makes it
sharper rather than newly broken: today a stranger who guesses a URL can approve
someone's film; afterwards they can also add to it.

I do not think that blocks this block — a v4 UUID is not guessable, and the
alternative is building auth first — but it should be a conscious choice rather
than a thing nobody said out loud. It is decision **D2**.

---

## 4. The walk-through

### The shape

Sixteen steps for `life-advice@1`, which is a lot to face at once, so they are
presented as three chapters with a visible break between them:

| Chapter | Steps | Needs the subject present? |
|---|---|---|
| **Their story** | 9 required questions + 1 optional | Yes — this is the interview |
| **Photographs** | 3 required photos | No |
| **Moments** | 2 required videos + 1 optional + 1 optional keepsake | No |

The chapter break matters more than it looks. The photographs and b-roll can be
gathered on a sofa a week later; the interview needs two people and one sitting.
Splitting them means nobody has to hold an elderly relative in a chair while
they hunt for a photo from 1974 — and it is the strongest argument for
save-and-resume being in v1 rather than deferred.

Order within a chapter is the template's business, not the app's (§ 5).

### One step

Every step, whether it wants a recorded answer or a photograph, is the same
five things:

```
  Step 4 of 16 ·············································

  What is the greatest lesson life has taught you?     <- the ask

  Let them think. The pause before the answer is
  usually where the good version comes from.            <- the coaching

  [ ● Record ]        [ Choose a file ]                 <- both, always

  ( what they gave us, playable, with a Retake )        <- the result

  [ Back ]                                [ Next → ]    <- movement
```

The ask and the coaching both come from the template. Both buttons are on every
step, always: some moments have to be captured now and others already exist, and
that difference is about the moment, not about the kind of file. A photo step
offers the camera too — a photograph of a photograph, held up to a phone, is how
most 1974 prints will actually reach us.

### The coaching copy is the product

This is the requirement to take most seriously. The film is only as good as what
people give us, and what they give us depends almost entirely on what we asked
for. "Add a photo" gets a screenshot. "Add a photo of the person from another
time" gets the one from 1974. It is the cheapest lever on output quality in the
whole system — cheaper than transcription, cheaper than better selection — and
it costs a string.

---

## 5. Where the copy lives

**In `@film/templates`. Never in `apps/web`.**

This follows an invariant that already holds: *template rules are data, not
code*. `LIFE_ADVICE_V1` already carries `questions[].text` and `slots[].label`
("An earlier photo"); guidance is the same kind of thing, one field richer.

The test of the boundary is concrete: **a second film type must ship its own
walk-through without a line of React changing, and `apps/web` must not contain a
single string that only makes sense for life-advice.**

### The extension

```ts
/** What to ask for, and why it makes the film better. */
export type Guidance = {
  /** Imperative, one line. The thing we want. */
  readonly ask: string;
  /** Optional second line: how to get a good one. */
  readonly coaching?: string;
  /** Two or three, never more. A list is a menu; six is a form. */
  readonly examples?: readonly string[];
};

export type CaptureStep =
  | { readonly kind: "question"; readonly questionId: string }
  | { readonly kind: "slot"; readonly slotId: string };

export type CaptureChapter = {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly steps: readonly CaptureStep[];
};
```

`Question` and `MediaSlot` each gain `readonly guidance?: Guidance`, and
`Template` gains `readonly capture: { chapters: readonly CaptureChapter[] }`.

An explicit chapter list rather than deriving the order from `questions[].order`
plus the slot arrays: the recording order is a different concern from the edit
order, and the owner must be able to reorder the walk-through without touching
the film's structure. The cost of an explicit list is that it can fall out of
sync, which is what `validateTemplate` is for — a new check that every required
question and every required slot appears **exactly once** across the chapters.

For `life-advice@1`, the owner's own example lands as:

```ts
{
  id: "photo_early",
  label: "An earlier photo",
  required: true,
  guidance: {
    ask: "Add a photo of the person from another time",
    coaching:
      "Younger, or just years ago. Seeing them at a different age is what " +
      "makes the film feel like a life rather than an interview.",
    examples: ["A wedding photo", "Them in their twenties", "Holding a baby"],
  },
}
```

Writing the other fifteen is a content task, not an engineering one, and it is
where most of the film's quality is decided. I will draft them; they need the
owner's eye before they ship.

---

## 6. The session

**The project exists before capture starts.** Assets carry a non-null
`project_id`, so something has to exist first, and that settles the checkpoint's
first open question.

- `GET /start` — one short form: who is being filmed, their age, the
  relationship, and the interviewer's email. This is not busywork: every one of
  those fields feeds text interpolation ("I interviewed my 94 year old
  grandmother"), and today they are typed into `project.json` by hand. That
  settles the checkpoint's second open question — subject data is step zero of
  the walk-through, not a separate admin screen.
- `POST /start` creates the user (`ensureUser`, as intake does) and the project
  with `status: "capturing"` — a value that has been in the enum since Block 1
  and has never been written by anything — then redirects.
- `/projects/[id]/capture` — the shell. Resolves the first incomplete step and
  redirects to it, so returning to the bare URL always resumes.
- `/projects/[id]/capture/[stepId]` — one step, server-rendered from the
  template and the rows.

**Leaving and coming back works because state lives in Postgres, not in React.**
There is no wizard state to lose: what has been captured is what has asset rows.
The URL is the only thing the customer must keep, which — with no auth and no
mail provider — means the flow must show it, and the device should remember it
in `localStorage`. That is a plaster over the missing account, and worth naming
as one.

---

## 7. Getting the bytes into storage

**Media never proxies through the app server.** `signedPutUrl` exists for
exactly this.

```
browser                     web app                         store
   │  POST .../upload  ──────►  mint assetId + key
   │                            signed PUT URL (≤900s, one key, one method)
   │  ◄──────────────────────
   │  PUT bytes ─────────────────────────────────────────────►
   │  POST .../complete ─────►  head(key): does it exist, is it non-empty?
   │                            INSERT the asset row
   │  ◄──────────────────────   step done
```

**The row is written after the bytes land, never before.** This is intake's rule
and it is load-bearing: an orphaned object is invisible and sweepable, whereas a
row pointing at nothing is a project that fails at ingest for a reason nobody
can see from the database. The asset id is minted early because the storage key
needs it, but no row exists until `head()` has confirmed there is something
there. It also means **no schema change** — no "pending" flag, no state machine
on the asset.

`sha256` stays null on this path and is filled by ingest, which downloads the
original anyway. The browser never asserts it, which is the existing rule and
the right one.

`capture_method` is finally written for real: `"browser"` for a MediaRecorder or
camera capture, `"native_upload"` for a chosen file. That column exists to
measure which path people actually finish, and it has never had anything to say.

**Locally there is no R2**, and `signedPutUrl` returns a `file://` URL a browser
cannot PUT to. So the dev path needs an upload route in `apps/web` — the mirror
image of `/api/media/[...key]`, which already exists so reads work with no cloud
account. Same shape both ways; `usingLocalStore()` picks.

### A retake

A new asset id, a new object, a new row — then the previous row is deleted,
which cascades its stage executions. Nothing is overwritten. "The customer's
original is never overwritten" is about normalisation, but the same instinct
applies: a retake is a new take.

### Why not multipart, yet

`upload_sessions` exists — multipart id, `parts` jsonb persisted as each part
lands, a `(status, created_at)` sweep index — built so a phone that drops out
mid-answer does not lose the take. It is the right machinery and I am proposing
we **do not use it in v1**, for two reasons:

- `ObjectStore` has no multipart methods at all. Create, upload-part and
  complete would all have to be added to the interface, to R2, and to the local
  store, and then tested against a real bucket. That is its own block.
- A 90-second answer at a phone's default bitrate is roughly 25-30 MB. A single
  PUT of 30 MB is a few seconds on anything decent. When it fails, the cost is
  **one step**, not the project — which is a property of the walk-through being
  step-shaped in the first place.

Instead: uploads run in the background from the shell while the customer moves
to the next step, so nobody watches a progress bar after every answer. Closing
the tab loses an in-flight upload and that step reverts to empty, which is
honest and recoverable.

The threshold for revisiting is a measurement, not a feeling: if real sessions
show upload failures at a rate that costs people takes, multipart-as-you-record
is the fix, and the schema is already waiting for it.

---

## 8. Ingest while they are still there

Add `capturing` to the dispatcher's `ACTIVE` list and gate compose on the
project having left it. Two conditions, and they buy something disproportionate.

Ingest already measures every asset and writes `warnings` — too dark, almost no
speech, wrong aspect. Today those warnings surface at **approval**, hours later,
when the subject has gone home and re-recording means arranging another sitting.
If ingest runs per asset during capture, the same warning can appear on the step
that produced it, while the camera is still up:

> We could barely hear anything on that one. Try again?

That is the difference between a warning and a save. It uses machinery that is
already built and already tested, it costs two conditions in `dispatch.ts`, and
it is the reason § 3.3 (do not fail a capturing project) is not optional.

---

## 9. Finishing

A shared readiness function — `captureReadiness(template, rows)` — returns what
is still missing. **One function, three callers:** the chapter progress display,
the finish button's enabled state, and the gate itself. One source means the
progress bar cannot disagree with the gate, which is the classic way a "you're
all done!" screen sits next to a disabled button.

`createProject`'s hand-rolled `validate` gets rewritten in terms of it, so the
terminal path and the browser path cannot drift apart about what a startable
project is.

Finishing is one transaction: attach the music bed (§ 3.2), write
`config.questionPrompts` from the template's defaults, move the project from
`capturing` to `processing`. The dispatcher picks it up on its next tick — no
new mechanism, because there is not supposed to be one.

Then redirect to the waiting page from § 3.4, which becomes the preview page the
moment compose lands.

---

## 10. iOS is the only real unknown

Everything above is known work. This is not, and it should be settled **before**
the design is built on top of it rather than discovered halfway through — this
project has repeatedly punished guessing.

**Spike, half a day, before any of § 4-9:** a throwaway page that records ten
seconds on a real iPhone and reports what it got — `MediaRecorder.isTypeSupported`
across the plausible mime types, the actual `mimeType` of the blob, its size,
and whether the file `ffprobe`s as something ingest can normalise. Then the same
on Android Chrome and desktop Safari.

The fallback if MediaRecorder is unusable is already in the design and is not a
downgrade: `<input type="file" accept="video/*" capture="user">` opens the native
camera, which produces a better-encoded file than MediaRecorder would, at the
cost of the in-page preview. On iOS that may simply be the better path outright,
in which case "Record" means "open the camera" there and the flow does not
change shape at all.

What the spike must **not** do is inform a guess. If it says MediaRecorder is
fine, we use it; if it says otherwise, the capture button changes and nothing
else does.

---

## 11. What this deliberately does not do

- **No auth** (§ 3.5). The link is the credential.
- **No payment.** Nothing charges anyone; that is Phase 8.
- **No word-level timings or LLM selection.** Transcription here produces the
  whole answer's text, which is what a person types today. Phase 4 replaces the
  source, not the shape.
- **No editing.** The customer approves or does not, as now.
- **No multipart uploads** (§ 7), until a measurement asks for them.
- **No polished UI.** Legible, calm, and finishable on a phone. The stated
  priority is a product that works and can be used by many people.

---

## 12. Build order

One commit each, in an order where every step leaves the repository working:

1. **The iPhone spike** (§ 10). Throwaway; the finding goes in the checkpoint.
2. **Guidance in `@film/templates`** — the types, the `capture` chapters,
   `validateTemplate`'s completeness check, and the sixteen pieces of copy for
   `life-advice@1`. No app changes; this is data and tests.
3. **`captureReadiness`** in `@film/pipeline/model`, with `createProject`'s
   `validate` rewritten in terms of it.
4. **The upload path** — `signedPutUrl` wiring, the local-dev upload route, and
   the mint/complete pair, with the row written only after `head()` succeeds.
5. **`/start` and the shell** — project creation in `capturing`, resume,
   progress.
6. **The step screen** — record or upload, retake, both mime paths.
7. **Ingest during capture** (§ 8) — the two dispatcher conditions, the
   no-fail-while-capturing rule, and per-step warnings.
8. **The music bed from the registry** (§ 3.2) — `assetKey`, the operator upload
   script, the copy-on-finish.
9. **The `transcribe` stage** (§ 3.1), if D1 says yes.
10. **Finish and the waiting page** (§ 3.4), then the whole thing end to end on
    a real phone with a real person.

Steps 2-4 are testable without a browser. Step 10 is where it becomes true.

---

## 13. Decisions I need from you

**D1 — transcription.** Does the `transcribe` stage go in this block? Without
it, capture produces projects that reach compose and fail permanently (§ 3.1).
My recommendation is yes, in this block, because capture without it delivers
nothing. If it is a separate block, capture must ship after it, not before.

**D2 — no auth.** Confirm that shipping capture with the project URL as the only
credential is acceptable for now (§ 3.5), on the understanding that anyone with
a link can add to, approve and download the film.

**D3 — which speech-to-text.** Only if D1 is yes. It is a hosted API call on
customer voice recordings, so it is a privacy decision as much as a technical
one: whichever provider, the terms must forbid training on the audio, which is
the same commitment already made about customer media.

**D4 — the copy.** I will draft all sixteen asks and their coaching lines, but
they are the highest-leverage strings in the product and they should sound like
the person who is selling this film, not like the person who is building it. Do
you want to write them, or edit mine?
