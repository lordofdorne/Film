# Phase 3b — The capture experience

**Status:** Blocks 1–7 built and merged · 2026-08-18. Block 8 (transcription)
is open: the owner deferred the provider decision on 2026-08-17, and until it
is made a browser-made film still reaches compose and dies there.

Three things landed differently from the plan below, and the code is right
where they differ:

- **The delivery address lives on `projects.deliver_to`**, not in `users`.
  `users.email` is unique and decides ownership, so an address typed
  mid-capture — unverified, by an anonymous visitor — must not touch it.
- **Blocks 5 and 6 shipped as one commit.** The hub links to the step sheet and
  the step sheet returns to the hub; splitting them would have left a commit
  where neither worked.
- **`adoptFilms` is how films follow a person** from the anonymous identity to
  the verified one, and it refuses any source row that has an email.

The walk-through built in Block 5 works mechanically and is the wrong shape.
This is the redesign, written so an agent with no memory of the conversation can
carry it out. Read `docs/CHECKPOINT.md` first, then this.

---

## 1. What the owner asked for

Four answers, given 2026-08-14. Everything below follows from them, and where
this document invents something it says so.

1. **The first thing after Start is choosing what kind of film to make.** Not a
   form, not an explainer. A chooser — even though only `life-advice@1` exists
   today, the flow is built as though there will be several.
2. **The person's details are steps in the walk-through, not a form.** Name,
   age, relationship, email. "What is your name?" is already question one of the
   interview; the typed fields join the same flow, in the same visual language,
   so it never feels like signing up for something.
3. **The layout is a hub, not a wizard.** One overview showing every ask as a
   card — done, missing, optional — and tapping one opens just that capture.
   People choose their own order, see the whole shape, and can put the phone
   down and pick it up somewhere else in the list.
4. **Three things it must feel like:**
   - **Reassurance that it is going well.** After each take: we could hear you,
     the light is fine, it is long enough.
   - **A sense of how much is left.** Honest, in minutes.
   - **Never feeling trapped.** Skip anything, change anything, leave and come
     back on another device.

What is being replaced: a six-field form, then seventeen numbered pages with
Back and Next, and quality warnings that only appear at approval — hours later,
when the person has gone home.

---

## 2. The shape

```
  /make                    choose a film            (template chooser)
      │
      ▼
  /projects/[id]           THE HUB                  (the home of the flow)
      │                    ┌──────────────────────────────────┐
      │                    │  Ada's film        4 of 17 done  │
      │                    │  about 20 minutes left           │
      │                    │                                  │
      │                    │  THEIR STORY                     │
      │                    │  ✓ What is your name?            │
      │                    │  ✓ How old are you?      · heard │
      │                    │  ○ The greatest lesson…          │
      │                    │  ⚠ What is love?    · very dark  │
      │                    │                                  │
      │                    │  PHOTOGRAPHS                     │
      │                    │  ○ A photo from another time     │
      │                    └──────────────────────────────────┘
      ▼
  /projects/[id]/step/[stepId]   one capture, opened from the hub
```

**The hub is the product.** It is where somebody lands after choosing, where
they return after every capture, and what they see when they come back three
days later. It replaces both the old `/start` form and the numbered pages.

**A step is a detour, not a destination.** Open it, give us the thing, come
back. There is no Next — finishing a step returns to the hub with that card
ticked. Nobody is ever mid-sequence, so nobody is ever trapped in one.

**Detail steps look like every other step.** "What do you call them?" is a card
in the hub next to "Add a photo of the person from another time". One of them
opens a text field and the other opens a camera; both are things the film needs.

---

## 3. The problem this creates

**A project must exist before anyone has said who they are.**

Details are steps now, so at the moment `/make` creates a project there is no
name, no age, and no email. Three things in the schema disagree with that:

- `projects.owner_id` is `NOT NULL` and references `users`.
- `users.email` is `NOT NULL` and now `UNIQUE`.
- `projects.subject_data` is `NOT NULL`.

`subject_data` is the easy one: `{}` is a valid jsonb object, and
`resolveCaptureSteps` already falls back to `guidance.ask` when a question's
wording needs a token the project does not have. That fallback was written for
the bonus question and turns out to be exactly what a project with no subject
needs. Verify it holds for every step before relying on it.

Ownership is the real question, and there are three ways to answer it.

**Recommended: Supabase anonymous sign-in at project creation.**
`signInAnonymously()` returns a real session immediately — a real row in
`auth.users` with no email. The project is owned properly from birth, every
existing guard works unchanged, and when the customer later gives an email
Supabase links that identity to the same user. It also **deletes the capture
pass**: `apps/web/src/server/capturePass.ts` exists only because there was a gap
between creating a project and having a session, and anonymous sign-in closes
that gap properly rather than papering over it.

- Cost: anonymous users accumulate for every abandoned visit; Supabase can be
  told to clean them up, and abandoned projects need a sweep regardless.
- Check first: that anonymous sign-in is enabled on the project, and that
  `linkIdentity` handles an anonymous user gaining an email — it currently keys
  on `authId` first, which is the right order, but it has never seen a user
  whose email arrives *after* the row was created. **Write that test before
  writing the code.**

*Alternative A:* keep the capture pass and create a placeholder user row per
project. Works, but invents a second kind of user and leaves rows that are not
people. *Alternative B:* ask for the email first, before the chooser. Rejected
by answer 2 — that is the form again, wearing a different hat.

---

## 4. What changes, in order

Each block leaves the repository working and is one commit. Blocks 1–3 are
testable without a browser.

### Block 1 — Detail steps in `@film/templates`

`CaptureStepRef` gains a third kind:

```ts
| { readonly kind: "detail"; readonly fieldId: string }
```

`Template` gains a `details` array describing the fields it needs, in the same
shape as everything else the customer reads — because template rules are data,
and the web app must contain no string that only makes sense for one film:

```ts
export type DetailField = {
  readonly id: string;            // "subjectName", "age", "relationshipLabel", "ownerEmail"
  readonly kind: "text" | "number" | "email";
  readonly required: boolean;
  readonly guidance: Guidance;    // ask, coaching, examples — as steps already have
  /** Where it lands: subject_data, or the project's owner. */
  readonly target: "subject" | "owner";
};
```

`ResolvedCaptureStep` gains `kind: "detail"` with the field attached, and every
step gains `estimatedSeconds` so the hub can say how long is left. Put the
estimates in the template; they are content, not code.

`validateTemplate` must check that every field `SubjectData` requires is asked
for by some detail step. A film that cannot be worded is worse than one that
cannot be started.

For `life-advice@1`: four detail steps, worded like the rest —
"Who is this film for?", "How old are they?", "What are they to you?",
"Where should we send it?".

### Block 2 — A project with no subject

`startCapture` in `packages/pipeline/src/capture.ts` takes a template id and
nothing else. `subject_data` starts `{}`.

Add `saveDetail(deps, projectId, fieldId, value)`, which validates against the
template's `DetailField` and merges into `subject_data` — or, for
`target: "owner"`, sets the project's owner. Tested against real Postgres like
everything else in that file.

`captureReadiness` counts detail steps too: a film is startable when every
required question, slot **and** detail is answered.

### Block 3 — Ownership without identity

Anonymous sign-in, per §3. Delete `capturePass.ts` once it is unnecessary; do
not leave both.

`linkIdentity` gains the case where an anonymous user supplies an email later —
including the collision where that email already belongs to somebody else's
row. **That collision is the dangerous one**: it must merge deliberately or
refuse, never silently hand over films. There is already a test for the
equivalent case; extend it rather than writing a parallel one.

### Block 4 — `/make`, the chooser

Reads `TEMPLATE_REGISTRY`, lists what is available with its display name and
target duration, creates a project for the chosen one, redirects to the hub.
One template today; it must not be special-cased.

### Block 5 — The hub

`/projects/[id]` becomes the hub while the project is `capturing`, and stays the
preview once it is not. Chapters as headings, steps as cards, each showing:
done / missing / optional, a thumbnail where there is one, and any QC note.

Header carries progress and honest time remaining, summed from
`estimatedSeconds` over what is still missing.

"Make my film" lives at the bottom, enabled by the same `captureReadiness` that
drives the cards — one source, so the page cannot say "all done" beside a
disabled button.

### Block 6 — The step sheet

`/projects/[id]/step/[stepId]`. Record or upload, play it back, retake in one
press — all of which exists in `StepClient.tsx` and mostly survives. Detail
steps render an input instead of a camera. Finishing returns to the hub.

Delete Back/Next and the "step N of 17" counter. The hub is the map now.

### Block 7 — Reassurance, which means ingest during capture

The one that needs the pipeline, not the app. From
`docs/proposal/phase-3-capture.md` §8, unchanged and still right:

- add `capturing` to `ACTIVE` in `packages/pipeline/src/dispatch.ts`
- gate compose on the project having left `capturing`
- **never mark a capturing project failed** — one bad photograph must not end a
  film while the customer is sitting there able to replace it

Then surface `assets.warnings` on the hub card and in the step sheet, in the
customer's language rather than the QC code's: "we could barely hear that one —
try again?" Ingest already measures all of it; today it arrives at approval,
hours too late to act on.

### Block 8 — Transcription

Still the blocker, unchanged by any of this: `compose` permanently rejects an
interview take with no `selection.spoken`, and nothing produces those words. A
film made in the browser ingests cleanly, reaches compose, and dies.

**Nothing in blocks 1–7 produces a deliverable film without this.** The owner
should decide the provider before this block starts; see §6.

---

## 5. What is test-only and must not reach a thousand people

Written down because the owner raised it, and because none of it is obvious
from the code:

- **The music bed is a commercial recording** used as a scratch track,
  registered `usage: "temp-track"`, loaded by `pnpm bed:upload` from
  `incoming/songs`. The validator refuses it unless `ALLOW_UNLICENSED_MUSIC=1`.
  Three licensed instrumentals with marked cue sheets are owed before launch.
- **B-roll is placeholder** — generated fixtures stand in for
  `video_environment` and friends whenever `incoming/broll` is empty.
- **Storage is local disk** until the four `R2_*` variables are set.
- **One template**, and the chooser will look thin with a single card until
  there is a second.
- **No payment.** Nothing charges anyone.
- **The built-in mail sender allows about two emails an hour**, which is not a
  product. Custom SMTP is a launch blocker.

---

## 6. Open questions for the owner

- **Which speech-to-text provider**, and on what terms. It is a recording of
  someone's grandmother, so the licence must forbid training on the audio. A
  hosted API costs pennies a film and returns word timings; whisper.cpp on the
  worker keeps the voice on our own machines and costs CPU on the most
  expensive box we run. This decision blocks Block 8.
- **Does the chooser show anything but Life Advice?** If a second template is
  months away, Block 4 is a page with one card on it and should be built
  accordingly — quickly, and without a design.
- **How long should an abandoned project live?** Anonymous users and half-made
  films accumulate. `projects.retention_expires_at` exists and nothing sets it.

---

## 7. What does not change

The parts that are right, so that nobody rewrites them:

- **The row is written only after the bytes land.** Uploads go straight to
  storage; the absence of a row is the pending state.
- **Guidance copy lives in the template.** A second film type ships its own
  walk-through with no React changing.
- **Authorisation is checked where the data is** — the download route, the
  media route, and every server action — and answers 404, never 403.
- **Resume works because state lives in rows**, not in React.
- **`captureReadiness` is the single source** for both progress and the gate.
