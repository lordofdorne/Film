# Checkpoint — 2026-08-11

State after Phase 1, the real-media proof, Blocks 1–3 of the production
pipeline, the download surface and the capture walk-through. Written so a
session with no conversational context can pick this up from the repository
alone.

`main` is at `aed25b9`, and this branch adds the capture walk-through on top of
it. Ten packages, two apps, 279 tests.

**Capture requirements are at the bottom, in "The capture flow"** — they come
from the owner rather than from the code. `docs/proposal/phase-3-capture.md` is
the design written against them, and the walk-through is the first part of it
built.

---

## Priority, stated by the owner

> Focus on making sure the product **works and can be used by many people**.
> Auth, saved user videos and a polished UI come later.

---

## What works today

**A film goes from recordings to a delivered file with nobody running a
script, and the customer can download it.** Media can now be captured in a
browser too, though a film cannot yet be made end to end from one — see
"The capture flow".

```bash
pnpm install
pnpm db:up && pnpm db:migrate
cp .env.example .env   # one env file; every command below reads it

pnpm auth:up    # local Supabase: sign-in, and Mailpit on :54324 for the links
pnpm bed:upload # once: puts the music bed where capture can find it
pnpm intake     # incoming/ -> object store + Postgres, then stops
pnpm worker     # takes it from there
pnpm web        # localhost:3200 — /make to start a film, /projects/<id> is its hub
```

Three environment variables are easy to get wrong and fail quietly:

- `STORAGE_ROOT` — the worker writes objects here and the web app reads them.
  **Use an absolute path.** Next runs with its working directory at `apps/web`,
  so a relative one resolves somewhere different for the app than for the
  worker, and the symptom is a blank preview with no error anywhere. There is
  one env file now: `apps/web/.env.local` is gone, and `next.config.ts` loads
  the root `.env` instead, because two files that had to agree was a bug with a
  waiting period.
- `ALLOW_UNLICENSED_MUSIC=1` — without it compose refuses the temp bed, which
  is correct and is also the only bed that exists right now.
- `DATABASE_URL_WORKER` must be direct or session mode, never a transaction
  pooler. `@film/db` refuses at startup rather than letting pg-boss silently
  never deliver a job.

A worker left running against the development database will pick up any
project a test leaves behind, so the test suites clean up after themselves.

Measured on the real recordings, 2026-08-08:

| Step | Result |
|---|---|
| intake | 18 assets (10 takes, 4 photos, 3 placeholder b-roll, 1 music source) uploaded |
| ingest | 18 stages, ~35s total, 14 QC warnings derived |
| compose | EDL v1 — 28 visual, 11 speech, 2 prompt segments, 3:03 |
| approve | in the browser, which requested the delivery render |
| render | 5481 frames in 379s |
| deliver | 115.8 MB at −14.80 LUFS / −0.75 dBTP |
| download | 115,831,887 bytes, sha256 identical to the stored object |

The offline path still works and still needs nothing: `pnpm film`,
`pnpm project:build`, `pnpm film:real`.

| Phase | State |
|---|---|
| 1 — Handwritten EDL, validator, renderer | Complete |
| 2 — Ingest and QC | Ingest is a real stage. Normalisation, speech measurement, rotation, QC warnings. No HDR tonemapping. |
| 3 — Browser capture | Walk-through built: record or upload per step, retake, resume, finish. **Cannot yet produce a film** — see below. |
| 4 — Transcription | Not started. Caption text is supplied at intake; word timings estimated. |
| 5 — Compose | Deterministic, storage-backed, appends edl_versions. No cue alignment, no LLM selection. |
| 6 — Preview and approval | Done. Player preview, warning gate, approval, download, and only for the owner. |
| 7 — Production render | Done. Worker, dispatcher, reconciler, render, deliver. |
| 8 — Accounts and payment | Sign-in done: Supabase Auth, magic link. No payment. Deliver sends no mail. |

---

## The shape of it

```
intake  ──>  Postgres rows + objects in storage
                      │
                      ▼
        ┌──── worker tick, every 5s ────┐
        │  reconcile stalled stages      │
        │  plan from rows -> enqueue     │
        └───────────────┬────────────────┘
                        ▼
     ingest ─> compose ─> [customer approves] ─> render ─> deliver
```

**Nothing chains stage to stage.** Every step is derived from rows by
`planProject`. A queue that is drained, corrupted or rebuilt from scratch costs
one tick of latency and nothing else, because nothing is only recorded in a
job. It is also the same code path in the normal case and the recovery case, so
recovery is exercised constantly instead of being the branch nobody has run.

### Packages

| Package | Depends on | Role |
|---|---|---|
| `@film/edl` | **zod only** | Schemas and the validator. 44 rules. |
| `@film/formats` | — | Format registry (`landscape-classic`). |
| `@film/music` | zod | Track schema, registry, cue sheets, licensing. |
| `@film/templates` | edl, formats, music | `LIFE_ADVICE_V1`, text interpolation. |
| `@film/render` | edl, formats, music, templates | Remotion composition, framing, captions, audio, props builder. |
| `@film/db` | zod, drizzle, pg | Data model, connections, stage execution, approvals. |
| `@film/queue` | db, pg-boss | Queue topology, payloads, per-stage policy. |
| `@film/storage` | zod, aws-sdk | Project-scoped object store: local disk and R2. |
| `@film/pipeline` | all above | What each stage does, the runner, dispatcher, reconciler, intake. |
| `apps/worker` | db, queue, storage, pipeline | The process. ~170 lines. |
| `apps/web` | db, storage, pipeline/model, render/props | Preview and approval. |

Dependencies flow one way. `@film/edl` has **no package dependencies** — this
is load-bearing, not incidental.

Subpath entries that matter: `@film/render/props` (React-free, so Next can
import it), `@film/pipeline/model` (no Remotion, same reason).

---

## Invariants that must not be broken

**The validator runs before the renderer, and the renderer assumes validity.**
Every invariant lives in `packages/edl/src/validate/`. Nothing downstream
re-checks. A new rule goes there with a deliberately malformed fixture.

**Template rules are data, not code.** The validator never imports
`@film/templates`; conformance arrives in a `ValidationContext`.

**Audio doubling is unrepresentable.** `InterviewSegment` and `BrollSegment`
have no audio field and every object is `.strict()`. Three audio routes:
`SpeechTrack`, `PromptTrack`, `MusicBed`. A boundary test enforces this.

**Determinism.** Every composition is a pure function of `(EDL, format, frame)`.

**Claim the row, then work.** `UNIQUE NULLS NOT DISTINCT` on
`(project_id, asset_id, stage, input_hash)` is what makes exactly-once true.
The nulls clause is required because project-wide stages have a null asset_id.

**Postgres is the source of truth; pg-boss is an accelerator.** Nothing may be
recorded only in a job.

**Preview is the same composition AND the same props builder as delivery.**
`buildProjectProps` is used by both. Only the paths differ — signed URLs in the
browser, local files in the worker.

**The customer's original is never overwritten.** `storage_key` is the upload,
`normalised_key` is what ingest made. A bad recipe must be re-runnable.

**A capture row is written only after its bytes are in storage.** The two
failure orders are not equally survivable: an orphaned object is invisible and
sweepable, a row pointing at nothing is a project that fails at ingest for a
reason nobody can see from the database. It is also why capture needs no
"pending" column — the absence of a row IS the pending state.

**Guidance copy lives in the template, never in `apps/web`.** The test is that a
second film type ships its own walk-through with no React changing, and that the
web app contains no string that only makes sense for life-advice.
`validateTemplate` refuses a template whose walk-through does not ask for
everything the film requires, exactly once.

**Ownership is checked where the data is, not where the link is.** A guard on
a page protects the page. The download route is where the film leaves the
building, `/api/media` is where the raw recordings do, and server actions are
callable whatever the page renders — so each of them checks, and each answers
404 rather than 403, because a refusal that says "not yours" confirms there is
something there.

**A session is read with `getUser()`, never `getSession()`.** The second trusts
the cookie the browser sent; the first verifies it with the auth server. That
is the difference between an identity and a claim.

**Deliver requires an approval for that exact cut.** A render row can exist
without one; delivering against it would send someone a film they never
watched. `deliverableFilm` re-establishes this with a join rather than trusting
a status column, because the download route is where the film reaches a person.

**The dispatcher and the runner share `MAX_ATTEMPTS`.** A runner that has given
up while the dispatcher keeps handing work out is a loop that looks like
progress.

---

## Hard-won details

- **An optional field that every caller happened to supply is not optional.**
  `coldOpen` — the phrase the film opens on — was typed by intake for every
  project that had ever reached compose. The first film made from transcripts
  had none, and compose failed permanently with `SCHEMA_INVALID at
  speechSegments.0.captions`: the schema names the empty array, never the
  missing field that emptied it. Compose now falls back to the opening of the
  answer itself. Look for this shape wherever `?? ""` feeds something with a
  `.min(1)` behind it.
- **A code fix does not re-plan a stage.** The input hash is the only thing the
  dispatcher compares, so fixing a permanently-failed stage requires bumping
  its recipe constant — and the project itself has to be moved out of `failed`
  by hand, because that status is not ACTIVE.
- **Env is read at boot.** A worker started before `.env` was corrected goes on
  failing with errors that describe the code rather than the process. Restart
  the worker after touching `.env`.
- **The web app must import `@film/pipeline` by subpath, never the root.** The
  root re-exports every stage, which drags Remotion's bundler and renderer into
  the Next server graph; the symptom is `Module parse failed: Unexpected
  character` on a binary webpack was never meant to see. That is what
  `@film/pipeline/model`, `/capture` and `/retry` are for.
- **`delayRender` at module scope leaks.** A handle created outside a React
  render pass is never reconciled; the watchdog kills the render at the timeout
  boundary after a thousand good frames.
- **Offthread video cache must be capped**, or ten 1080p sources push Chrome
  into swap and it stops executing JavaScript.
- **Silence detection must run on the original take, not the normalised one.**
  Normalisation lifts room tone above the gate.
- **Loudnorm's JSON is the *last* object in ffmpeg's stderr.**
- **Webpack needs `extensionAlias`** to map `./Foo.js` to `Foo.tsx` — needed
  separately for Remotion, Next, and Vitest (which also needs explicit subpath
  aliases, since a string alias matches by prefix).
- **Fonts inline as data URIs**; the font gate must be non-fatal in the Player.
- **Music must be levelled off a normalised baseline** (`BED_TARGET_LUFS`).
- **pg-boss queues default to `policy: "standard"`**, which deduplicates
  nothing. `"short"` is required for singleton-key collapse.
- **pg-boss `stop()` returns before its workers finish.** Wait for the
  `stopped` event or the process exits mid-job.
- **Importing a value from `@film/render/composition` in Next** drags React and
  Remotion into the server module graph, where page-data collection runs it
  outside a React tree and it fails on a missing `createContext`.
- **When the worker is containerised, node must be PID 1.** `pnpm worker` runs
  it under two wrappers and SIGTERM stops at the outermost, so the drain
  handler never fires and every deploy is a hard kill.
- **A hash over an array of rows must sort them itself.** Rows inserted in one
  statement share a `created_at` and Postgres may return them in either order.
- **Tests must clean up, not just scope their deletes.** A fixture project left
  in a database a worker is watching gets planned and swept for ever.
- **Boundary tests should strip comments** before grepping.
- **A malformed id in a URL reached Postgres**, which raises on the uuid cast,
  so every route that passed one through answered 500. `isProjectId` guards the
  boundaries that take an id from a URL.
- **A signed URL's TTL is checked when the request is made**, not while bytes
  move, so a 15-minute cap is fine for a 116 MB download.
- **A server action and a route handler are separate module graphs.** Next
  compiles and instantiates them independently, so a module-level random shared
  between them is two different values — the capture upload URL was minted with
  one secret and verified against another, and every upload answered 403.
  `globalThis` is the fix. Found by uploading a photograph.
- **Supabase rejects a redirect it was not told about**, and silently falls
  back to `site_url` — the magic link arrives pointing at the wrong port and
  sign-in appears to do nothing. `supabase/config.toml` lists the app's
  callback; a hosted project needs the same list in its dashboard.
- **A dev server does not notice a package.json `exports` change.** Adding
  `@film/pipeline/capture` typechecks and builds while the running dev server
  still cannot resolve it. Restart it.
- **`storeFromEnv()` used to build a client per call**, and the hub asks once
  per card — twenty pieces of media was twenty S3 clients and twenty cold TLS
  handshakes. It memoises on the resolved config now.
- **`pnpm worker` runs `pnpm build` first**, which runs `next build` and
  overwrites the dev server's `.next`. Running the worker beside a dev server
  means `tsx apps/worker/src/main.ts` directly, or a dead preview.
- **An unordered `LIMIT` over active projects starves live work.** Capturing
  projects are planned now and most are abandoned, so the dispatcher orders by
  `updated_at` — otherwise half-made films nobody returns to would fill the
  budget ahead of a customer waiting on a render.

---

## Open decisions

**Owed by the owner:** production music (three licensed instrumentals with
marked cue sheets), brand identity, real b-roll, approved caption and emphasis
styling. Mechanisms exist; values are placeholders.

**Known and deliberate gaps:**

- **Auth is only as configured as its environment.** With
  `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` unset the web
  app runs with no sign-in and every film is open to anyone with its link. That
  is what keeps the offline pipeline first-class, and every page says so in a
  banner — but a deployment that forgets those two variables is wide open.
- **No payment.** Nothing charges anyone.
- **Deliver sends no mail.** No provider is configured. It marks the project
  delivered against a specific render and says so.
- **`qc`, `transcribe` and `select` have queues and enum values but no
  implementation**, and the worker deliberately does not register them. A stage
  that succeeds without doing anything is indistinguishable from one that works.
- **Temp music.** `incoming/songs` holds a commercial recording used as a
  scratch bed, registered `usage: "temp-track"`. The validator refuses it unless
  `ALLOW_UNLICENSED_MUSIC=1`. Replace before launch.
---

## Next

1. **Browser capture (Phase 3).** The next block. See below.
2. **Transcription (Phase 4).** Caption text is typed in at intake and word
   timings are estimated. The biggest quality gap in the output.
3. **Delivery by email.** Deliver marks the project and says plainly that no
   mail provider is configured. A customer who closes the tab is not told —
   and sign-in already needs a mail provider, so one sender covers both.
4. **Re-render only what changed.** Segment caching keyed on content hash.
   379s per film is fine now and will not be at volume.

A different language would still not help: >99% of wall time is inside FFmpeg
and Chromium.

---

## The capture flow

**Requirements from the owner, 2026-08-10.** These are product intent and are
not derivable from the code. They govern the design of Phase 3.

> The flow is supposed to feel like a walk-through. Users will capture their
> videos/photos, or choose to upload. We need to have space for text to give
> them inspiration so that we create the best film possible. For instance for
> the life advice the first photo upload should have a suggestion like "Add a
> photo of the person from another time".

What follows from that:

**A walk-through, not an upload form.** One thing at a time, in an order the
template decides, with a sense of progress through it. The person on the other
end is often doing this once, for someone they love, possibly with an elderly
relative sitting in front of them. The interface is the interviewer.

**Record or upload, per step, always both.** Some moments have to be captured
now — the interview answers. Others already exist and only need finding — the
photographs. The same step must accept either without feeling like two
different products.

**Every step carries coaching copy, and that copy is the product.** The film is
only as good as what people give us, and what they give us depends almost
entirely on what we asked for. "Add a photo" gets a blurry screenshot. "Add a
photo of the person from another time" gets the one from 1974. This is the
cheapest available lever on output quality — cheaper than transcription,
cheaper than better selection — and it is worth treating as seriously as the
renderer.

**The copy belongs in the template, not in the app.** This follows from an
invariant that already holds: *template rules are data, not code*. `LIFE_ADVICE_V1`
already carries `questions[].prompt` and `slots[].label` ("An earlier photo");
the guidance text is the same kind of thing, one field richer. A second film
type must ship its own walk-through without a line of React changing, and the
web app must not contain a single string that only makes sense for life-advice.

### What already exists for this, unused

- `assets.capture_method` — `"browser" | "native_upload"`. Written by intake,
  never yet distinguishing anything. It is there to measure which path people
  actually finish.
- `upload_sessions` — multipart upload id plus a `parts` jsonb, persisted as
  each part lands, with a `(status, created_at)` sweep index. Built so a phone
  that drops out mid-answer does not lose the take, and so abandoned uploads
  can be aborted rather than billed for. Never used by anything.
- `ObjectStore.signedPutUrl` — so media never proxies through the app server.

### The design

`docs/proposal/phase-3-capture.md`, 2026-08-10. It answers the questions this
section used to leave open — the project is created before capture and sits in
`capturing`, subject data is step zero, and resume works because state lives in
rows rather than in React — and it found four things standing between "the
walk-through works" and "the walk-through produces a film", none of them visible
from the capture screens. One is now solved:

- **Every take needs its words.** `compose` permanently rejects an interview
  asset with no `selection.spoken`, and that text is typed by hand into
  `incoming/project.json` today. **Still open, and it is the next block.**
- **Every project needs a music bed**, which used to arrive as a file somebody
  dropped in `incoming/songs`. **Solved:** an operator loads a track once with
  `pnpm bed:upload` and every project takes its own copy when it is started.
- **The dispatcher would fail a project mid-capture.** One permanently bad
  photograph, when it is the only asset, is enough — while the customer is
  standing right there and could pick another. **Still open**, and it is why
  ingest does not run during capture yet.
- **There is no page between capture and preview.** `/projects/[id]` 404s until
  compose has written an EDL version. **Still open.**

### The capture experience was redesigned — blocks 1–7 are built

**`docs/proposal/phase-3b-capture-ux.md` is the plan, and blocks 1 to 7 of it
are done.** The owner reviewed the first flow on 2026-08-14 and it was the
wrong shape: a six-field form followed by seventeen numbered pages. Both are
deleted.

What exists now:

```
/make                          choose a film      (reads TEMPLATE_REGISTRY)
   │  press Start: anonymous sign-in, then a project owned from birth
   ▼
/projects/[id]                 THE HUB            (while status = capturing)
   │                           every ask a card: done / missing / optional,
   │                           thumbnail, QC note, honest minutes remaining
   ▼
/projects/[id]/step/[stepId]   one step, then back to the hub
```

- **Details are steps.** `CaptureStepRef` has a third kind, `detail`, and
  `Template.details` describes the typed answers a film needs. `subject_data`
  starts as `{}` and `saveDetail` fills it in.
- **The delivery address is `projects.deliver_to`, never `users.email`.** That
  column is unique and decides ownership; an address typed mid-capture is
  unverified. Clicking the link is what turns an address into an identity.
- **Ownership from the first press.** `signInAnonymously()` gives a real
  identity with no email. `capturePass.ts` is deleted rather than kept beside
  its replacement. When the person proves an address, `adoptFilms` moves the
  anonymous browser's films to the verified identity — and refuses any source
  row that HAS an email, so it cannot drain a real account.
- **Ingest runs during capture**, and a capturing project is never marked
  failed. Warnings reach the hub card in the customer's language.

Requires `enable_anonymous_sign_ins = true` on the Supabase project. Without
it, pressing Start says so on the page rather than doing nothing.

### There are two ways in now, and they were built not to collide

`docs/proposal/phase-4-storage-and-accounts.md` Part B is built. The magic
link stays and stays first; a password sits beside it for anyone who would
rather type one.

- **Setting a password never creates a second identity.**
  `updateUser({ email, password })` on the session already here keeps its auth
  id, so the films made anonymously need no adoption at all. `signUp()` would
  make a second identity and orphan every one of them.
- **An address is not ours until the mailbox is proved.** With
  `enable_confirmations = true`, Supabase holds it in `new_email` and the
  application row still says null — correctly, because that column decides who
  owns a film. The password is stored at once but cannot be used until the
  confirmation is clicked, and the copy says so.
- **`linkIdentity` now learns.** It matched on `authId` and returned the row
  without looking at the address, so a row that gained one kept `email = NULL`
  for ever. Fixed with tests; a null never erases a proved address, and a
  collision refuses rather than reaching across to the other row.
- **Where the two doors collided.** A confirmation in flight is invisible to
  `signInWithOtp`, which would happily make a SECOND identity for the same
  address — leaving a password on an account the person can no longer reach.
  `sendMagicLink` refuses to send while a confirmation for that address is
  pending, and says which link to open.
- **`/auth/recovery` is a separate door** from `/auth/callback`, because every
  proving link comes back as `?code=` with nothing to say which kind it was,
  and the route that adopts an anonymous browser's films must not grow a
  second mode.
- **`secure_password_change` is off, deliberately.** GoTrue applies it to
  setting a first password too and refuses any session older than a day —
  which is exactly the person being offered one. The reasoning is in
  `supabase/config.toml`; do not turn it on without walking the flow.
- **Supabase errors are read by code, never by status.** Every one of them is
  a 422, and mapping the status told people their own unused address already
  had an account.

Still to do before a real person can use it: **custom SMTP**. Confirmations,
resets and links all go through it, and the built-in sender allows about two
an hour.

### What it still cannot do

**It produces a film.** Block 8 landed on 2026-08-20 and the pipeline runs end
to end. Proved on 2026-08-21 with a real project whose typed answers were
deleted first, so transcription was the only possible source of the words: 10
takes transcribed, cut to 3:03, approved in the browser, rendered, delivered,
and downloaded — 302 to R2, 206 on a range request, `ftypisom` in the first
bytes, and the customer's filename in the content-disposition.

**The delivered film is 76 MB where it used to be 110 MB** for the same
footage at the same length (182.7s vs 182.8s). crf 21 and the `slow` x264
preset, both set in `renderMedia` — the loudness pass is `-c:v copy`, so that
encode IS the delivery and there is no lever downstream. The render costs 389s
of one machine's time, once; the download happens every time somebody wants to
watch.

`transcribe` is whisper.cpp, spawned like ffmpeg. Two things about it are worth
knowing before touching it:

- **It needs a binary and a model.** `brew install whisper-cpp`, and
  `WHISPER_MODEL` pointing at a ggml file (`models/` is gitignored; small.en is
  the chosen size). Nothing transcribes without both, and the error says so.
- **It does not use word timings**, though whisper can produce them.
  `distributeWords` lays captions out against the speech runs INGEST measured
  from the waveform, which are better than a model's guesses. The stage only
  ever wanted the words.
- **It runs per take, during capture**, so by the time somebody presses "Make
  my film" the words are already in the database.
- **A typed selection always wins.** Intake still types words in, and transcribe
  leaves any take that already has them alone.

Local was the point, not a compromise: the licence question that stalled this
decision — does the provider train on customer audio — has one answer that
cannot be got wrong, which is that the audio never leaves the machine. It also
costs nothing per film.

Also still true of a browser-made project:

- **No resumable upload from the browser.** `upload_sessions` remains unused.
  One PUT per take, and a failure costs one step rather than the project. The
  worker's own uploads to R2 *are* multipart now — that is `@aws-sdk/lib-storage`
  in `R2ObjectStore.put`, and it is a different thing.
- **MediaRecorder is proven on Chrome only.** It reports `video/mp4` support and
  produced h264/opus. iOS Safari is still unproven on a real device, and the
  fallback — the native camera through a file input — is already wired.
- **Only the owner can reach it.** Signed out is a redirect to sign-in;
  somebody else's film is a 404 on every surface, including the media route.
- **Nothing sweeps abandoned films.** Anonymous users and half-made projects
  accumulate; `projects.retention_expires_at` exists and nothing sets it. The
  ceiling until then is `MAX_UNFINISHED_FILMS` (10 per owner).

### Open questions for the owner

- ~~Which speech-to-text provider~~ — **answered 2026-08-20 by not choosing
  one.** whisper.cpp runs on the worker; there is no provider, no per-film
  cost, and no terms to read, because the audio never leaves the machine. If
  that is ever revisited for speed, the licence must forbid training on
  customer audio, and the interface to replace is `media/whisper.ts`.
- ~~Whether a failed project can be retried~~ — **answered 2026-08-21.** The
  failure screen has a "Try making it again" button. `retryProject` reopens the
  dead-end stage executions (attempt 0, failure class cleared, error text kept)
  and moves the project back to `processing`. Both halves are needed: a status
  change alone spins once and re-fails, because the dispatcher refuses a stage
  that used up its attempts.
  **A code fix still needs its recipe constant bumped** — the input hash is all
  the dispatcher compares, and no button changes that.
- Whether the walk-through's sixteen pieces of coaching copy read the way the
  owner would say them. They are the highest-leverage strings in the product.
