# Checkpoint — 2026-08-30

State after Phase 1, the real-media proof, the production pipeline, the
download surface, the capture walk-through, accounts, R2, transcription,
adaptive length and the hub's performance work. Written so a session with no
conversational context can pick this up from the repository alone.

`main` is at `0465f87`. Nine packages, two apps, 383 tests.

**A browser-made film now goes all the way through.** Somebody presses Start,
records, and receives a finished file — no script, no operator, nothing typed
in by hand. That was not true at the last checkpoint and it is the single
biggest change since.

**Capture requirements are at the bottom, in "The capture flow"** — they come
from the owner rather than from the code, and they are the part of this
document a reader cannot reconstruct from the repository. Everything the
proposals in `docs/proposal/` designed against them is now built; that section
records what was asked for and, under each heading, what it became.

---

## Priority, stated by the owner

> Focus on making sure the product **works and can be used by many people**.
> Auth, saved user videos and a polished UI come later.

---

## What works today

**A film goes from recordings to a delivered file with nobody running a
script, and the customer can download it — including a film captured entirely
in a browser.** `pnpm intake` is now one way in rather than the only one.

```bash
pnpm install
pnpm db:up && pnpm db:migrate
cp .env.example .env   # one env file; every command below reads it

pnpm auth:up    # local Supabase: sign-in, and Mailpit on :54324 for the links
pnpm bed:upload # once: puts the music bed where capture can find it
pnpm worker     # ingest, transcribe, thumbnail, compose, render, deliver
pnpm web        # localhost:3200 — /make to start a film, /projects/<id> is its hub

pnpm intake     # optional: incoming/ -> object store + Postgres, then stops.
                # The operator path. A film no longer needs it.
```

`transcribe` needs a binary and a model or nothing gets any words:
`brew install whisper-cpp`, and `WHISPER_MODEL` pointing at a ggml file.
`models/` is gitignored; small.en is the chosen size.

Four environment variables are easy to get wrong and fail quietly:

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
- `R2_ACCOUNT_ID` is the 32-hex account id, **not the endpoint URL** — pasting
  the whole `https://<id>.r2.cloudflarestorage.com` is the obvious mistake and
  produces a hostname with the URL inside it. Unset, everything falls back to
  local disk and the offline path stays first-class.

All four are read **at boot**. Restart the worker after touching `.env`; see
"Hard-won details".

A worker left running against the development database will pick up any
project a test leaves behind, so the test suites clean up after themselves.

Measured through the **intake** path on the real recordings, 2026-08-08:

| Step | Result |
|---|---|
| intake | 18 assets (10 takes, 4 photos, 3 placeholder b-roll, 1 music source) uploaded |
| ingest | 18 stages, ~35s total, 14 QC warnings derived |
| compose | EDL v1 — 28 visual, 11 speech, 2 prompt segments, 3:03 |
| approve | in the browser, which requested the delivery render |
| render | 5481 frames in 379s |
| deliver | 115.8 MB at −14.80 LUFS / −0.75 dBTP |
| download | 115,831,887 bytes, sha256 identical to the stored object |

And through the **browser** path, 2026-08-21, on a project whose typed answers
were deleted first so that transcription was the only possible source of the
words:

| Step | Result |
|---|---|
| transcribe | 10 takes, whisper.cpp on the worker, audio never left the machine |
| compose | cut to 3:03, then 1:58 once length became adaptive |
| deliver | **76 MB** where the same footage at the same length was 110 MB |
| download | 302 to R2, 206 on a range request, `ftypisom` in the first bytes |

The offline path still works and still needs nothing: `pnpm film`,
`pnpm project:build`, `pnpm film:real`.

| Phase | State |
|---|---|
| 1 — Handwritten EDL, validator, renderer | Complete |
| 2 — Ingest and QC | Ingest is a real stage. Normalisation, speech measurement, rotation, QC warnings. No HDR tonemapping. |
| 3 — Browser capture | Done. Walk-through, record or upload per step, retake, resume, finish — and it produces a film. |
| 4 — Transcription | Done. whisper.cpp on the worker, per take, during capture. No word timings by design — see below. |
| 5 — Compose | Deterministic, storage-backed, appends edl_versions. Length adapts to how much was said. No cue alignment, no LLM selection. |
| 6 — Preview and approval | Done. Player preview, warning gate, approval, download, and only for the owner. |
| 7 — Production render | Done. Worker, dispatcher, reconciler, render, deliver. |
| 8 — Accounts and payment | Sign-in done: Supabase Auth, magic link and password. **No payment. Deliver still sends no mail.** |

---

## The shape of it

```
intake, or the browser walk-through  ──>  Postgres rows + objects in storage
                      │
                      ▼
        ┌──── worker tick, every 5s ────┐
        │  reconcile stalled stages      │
        │  plan from rows -> enqueue     │
        └───────────────┬────────────────┘
                        ▼
     ingest ─┬─> transcribe ─┬─> compose ─> [approves] ─> render ─> deliver
             └─> thumbnail ──┘
```

`transcribe` and `thumbnail` run **per asset, during capture**, as soon as that
asset is ingested — while the customer is still recording the next answer. By
the time they press "Make my film" the words are already in the database and
the only thing left to wait for is the render.

`thumbnail` is off to the side on purpose: it never blocks the cut and can
never fail a project. It is a picture for a card in a list, and a film that is
otherwise fine must not die for one.

**Nothing chains stage to stage.** Every step is derived from rows by
`planProject`. A queue that is drained, corrupted or rebuilt from scratch costs
one tick of latency and nothing else, because nothing is only recorded in a
job. It is also the same code path in the normal case and the recovery case, so
recovery is exercised constantly instead of being the branch nobody has run.

### Packages

| Package | Depends on | Role |
|---|---|---|
| `@film/edl` | **zod only** | Schemas and the validator. 46 rules. |
| `@film/formats` | — | Format registry (`landscape-classic`). |
| `@film/music` | zod | Track schema, registry, cue sheets, licensing. |
| `@film/templates` | edl, formats, music | `LIFE_ADVICE_V1`, text interpolation. Each template names its editor. |
| `@film/editors` | edl, templates | One editor per film type: what was recorded in, the EDL out. `life-advice`, plus the shared toolkit. |
| `@film/render` | edl, formats, music, templates | Remotion composition, framing, captions, audio, props builder. |
| `@film/db` | zod, drizzle, pg | Data model, connections, stage execution, approvals. |
| `@film/queue` | db, pg-boss | Queue topology, payloads, per-stage policy. |
| `@film/storage` | zod, aws-sdk | Project-scoped object store: local disk and R2. |
| `@film/pipeline` | all above | What each stage does, the runner, dispatcher, reconciler, intake. Compose asks the template's editor and knows no film type. |
| `apps/worker` | db, queue, storage, pipeline | The process. ~170 lines. |
| `apps/web` | db, storage, pipeline subpaths, render/props | The walk-through, preview, approval, download. |

Dependencies flow one way. `@film/edl` has **no package dependencies** — this
is load-bearing, not incidental.

Subpath entries that matter, and they are all the same rule: the web app must
never import `@film/pipeline` at the root, because the root re-exports every
stage and drags Remotion's bundler into the Next server graph. `@film/render/props`
(React-free), `@film/pipeline/model`, `/capture`, `/retry`.

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

**The web app has ONE stylesheet.** `apps/web/app/globals.css` holds every
colour, type size and spacing step as a custom property, and every screen is
classes over that. It replaced nineteen per-file `styles` objects, twelve of
which had each written out the same green — which is most of what made the app
look like a project rather than a product. A new screen uses the tokens or
changes them; it does not start its own palette.

**The product is named in one place.** `apps/web/src/product.ts`. "Life Advice"
is a TEMPLATE id, not a product name, and using it as one would be wrong the
day a second film type exists. The current name is a placeholder awaiting the
owner, and nothing but that file needs to change.

**Reading rows and minting signed URLs are separate acts, and the types keep
them separate.** A signed URL is a bearer credential. `loadWalkthroughView`
returns storage keys and signs nothing; a caller asks for exactly the URLs its
page will draw. A component cannot be handed the unsigned shape by accident,
because it has no `url` on it to render. This began as a performance fix and is
kept as a security one.

**A list draws a thumbnail or nothing — never the customer's original.** The
hub referenced 105 MB to draw eighteen 56-pixel squares. Falling back to the
original when no thumbnail exists yet re-creates exactly that, on exactly the
films whose ingest is already cached and will never run again.

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
- **Never run a production build while `pnpm web` is running.** `next build`
  writes `apps/web/.next`, which the dev server is serving out of — so the site
  starts answering `Cannot find module './vendor-chunks/…'` or a bare Internal
  Server Error, and nothing in the message points at the build that caused it.
  It broke a running server three times. The recovery is `rm -rf apps/web/.next`
  and restart. The scripts that used to cause it — `worker`, `intake`,
  `bed:upload` — now run `pnpm build:packages` instead, which filters out
  `@film/web`; `pnpm build` itself is still unsafe beside a dev server.
- **No `loading.tsx` above a wizard step — beside one is fine.** Home and the
  film page each have one, in their own route groups (`app/(home)`,
  `projects/[id]/(overview)`), so neither wraps the wizard. Walked on a
  production build: Continue 6 of 6, Make my film 4 of 4. With one above — site-wide or
  the wizard's own — a save that revalidates the film intermittently left the
  router unable to move on, on a production build only: Continue saved and
  stayed on the same screen for good, by `router.push` and by a redirect from
  the action alike. Bisected over production builds (Phase 8, Block 1). The
  dev server never prefetches, so it cannot show this; check navigation
  changes with `pnpm perf` against `next build && next start`.
- **The database-backed tests share one development Postgres, and now run one
  file at a time.** They flaked twice — `dispatch.test.ts`, then a 120-SECOND
  timeout in `runStage.test.ts` — and both passed immediately when run alone.
  `fileParallelism: false` in `vitest.config.ts` costs about 13 seconds (31s
  against 18s). That was judged too much for the first unreproduced failure and
  obviously worth it for the second, which wasted two minutes on a timeout.
  Scoped project ids are not sufficient isolation on their own. A suite that is
  sometimes red for no reason is a suite people stop reading.
- **The web app must import `@film/pipeline` by subpath, never the root.** The
  root re-exports every stage, which drags Remotion's bundler and renderer into
  the Next server graph; the symptom is `Module parse failed: Unexpected
  character` on a binary webpack was never meant to see. That is what
  `@film/pipeline/model`, `/capture` and `/retry` are for.
- **`pnpm typecheck` did not check the web app until 2026-08-25.** `tsc -b`
  walks project references and Next owns its own tsconfig, so `apps/web` was
  outside the graph entirely — every web change since the app was built had
  been checked only by whatever `next dev` happened to compile. The script now
  runs `pnpm --filter @film/web exec tsc --noEmit` as a third step.
- **Two `next dev` servers on one `apps/web` fight over one `.next`.** The
  symptom is `__webpack_modules__[moduleId] is not a function` or a bare 500,
  and it looks exactly like a code error. So does switching branches under a
  running server. Recovery is the same: stop them, `rm -rf apps/web/.next`,
  start ONE.
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
- **`pnpm worker` used to run `pnpm build` first**, which runs `next build` and
  overwrites the dev server's `.next`. `worker`, `intake`, `bed:upload` and
  `thumbs:backfill` now run `pnpm build:packages`, which is the same build with
  `@film/web` filtered out — none of them ever needed the web app compiled, and
  the command that broke a running preview three times was never named after
  Next.
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
- **Deliver sends no mail**, and this is now the largest gap in the product. No
  provider is configured, so a customer who closes the tab is never told their
  film is ready. Deliver marks the project against a specific render and says
  plainly that nothing was sent. Sign-in needs a sender too — confirmations,
  resets and magic links all go through it, and the built-in Supabase sender
  allows about two an hour — so one provider closes both.
- **`qc` and `select` have queues and enum values but no implementation**, and
  the worker deliberately does not register them. A stage that succeeds without
  doing anything is indistinguishable from one that works. (`transcribe` was in
  this list until 2026-08-20 and is now real; `thumbnail` was added already
  implemented.)
- **A keepsake is the only slot that accepts either a photo or a clip**, and
  compose handles both as of 2026-08-30. It did not, and the clip was silently
  dropped from the finished film. Compose now emits a note for anything
  supplied that it did not place — worth reading in the stage log when a film
  comes out missing something.
- **Temp music.** `incoming/songs` holds a commercial recording used as a
  scratch bed, registered `usage: "temp-track"`. The validator refuses it unless
  `ALLOW_UNLICENSED_MUSIC=1`. Replace before launch.
---

## Next

Browser capture and transcription were the first two items here and are both
done. What is left, in the order it is worth doing:

1. **Delivery by email, and it needs the owner.** A finished film currently
   sits behind a link nobody is told about. Needs a provider account and a
   sending domain before a line of code helps. One sender covers sign-in too.
2. **Nothing sweeps abandoned films.** `projects.retention_expires_at` exists
   and nothing sets it. Anonymous users and half-made projects accumulate for
   ever; `MAX_UNFINISHED_FILMS` (10 per owner) is the only ceiling, and it
   bounds one person rather than the table.
3. **Payment.** Nothing charges anyone.
4. **A second R2 bucket** before real customer footage lands beside test data
   in `films`.
5. **Re-render only what changed.** Segment caching keyed on content hash.
   389s per film is fine now and will not be at volume.

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
from the capture screens. **All four are now solved**, which is why a film can
be made end to end in a browser:

- **Every take needs its words.** `compose` permanently rejects an interview
  asset with no `selection.spoken`, and that text used to be typed by hand into
  `incoming/project.json`. **Solved 2026-08-20:** the `transcribe` stage, run
  per take during capture.
- **Every project needs a music bed**, which used to arrive as a file somebody
  dropped in `incoming/songs`. **Solved:** an operator loads a track once with
  `pnpm bed:upload` and every project takes its own copy when it is started.
- **The dispatcher would fail a project mid-capture.** One permanently bad
  photograph, when it is the only asset, is enough — while the customer is
  standing right there and could pick another. **Solved:** a project in
  `capturing` is never marked failed; its dead ends surface as warnings on the
  hub card instead. That is what let ingest move inside capture.
- **There is no page between capture and preview.** `/projects/[id]` 404d until
  compose had written an EDL version. **Solved:** `WorkingNote` holds that
  moment and keeps checking. A 404 with somebody's whole film behind it was the
  worst possible screen for it.

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

### Shortening is never a surprise — Phase 9, Block 5

Before Approve, the preview lists every answer that lost words to fit its
share: the question, "We used 0:22 of 1:22", and — behind a quiet disclosure
— the passages left out (`FittedAnswers`). It ends with the one lever there
is today: record that answer again and say the important thing first, since
shaping always keeps an answer's opening. "Put it back" waits for
request-a-change.

`fittedAnswers` (`@film/editors`) works it out from the cut being shown — the
EDL's speech segments against the answer's timed words — so nothing is stored
that could disagree with the film. Films made before word times show nothing,
because nothing in them was shaped. Seen on `/design` with sample data; no
real film has been shaped yet, because none has word times.
### The music ends with the film — Phase 9, Block 4

- **`audio.musicEdits`** in the EDL (optional): at film time `atMs` the
  track continues from `toMs`, crossfaded over `crossfadeMs`. Forward skips,
  backward repeats. The validator keeps edits in order, the crossfades
  fitting, the track long enough for every stretch asked of it, and — on a
  track with a beat grid — both sides of each edit on a downbeat
  (`MUSIC_EDIT_INVALID`, `MUSIC_EDIT_OFF_BEAT`, `MUSIC_TRACK_TOO_SHORT`).
- **The renderer plays them** (`musicPiecesOf`, `MusicBed`): one piece of
  track per stretch, equal-power crossfades. Ducking is a function of film
  time and carries across an edit untouched. Rendered and measured around a
  four-bar skip on the sample film: no dip, no silence.
- **The life-advice editor fits the music** (`fitMusic`, version 7): one edit
  in the middle of the music, downbeat to downbeat, lands the track's
  `endingMs` cue on the end title; the black hold before the end title (2.4 s,
  allowed 1.2–4 s) takes what the bar line cannot.
- **Only for commissioned tracks.** Fitting needs a measured beat grid and
  an ending cue. The temp beds are loops with neither, so every film so far
  plays its bed straight through and fades, exactly as before. When real
  tracks are commissioned their cue sheets (title, lifts, resolution,
  ending) and beat grids must be marked against the recording — the temp
  bed's cues were borrowed from the placeholder and mean nothing.
- Now that shares hold films under ~3:40, a 240-second track with its ending
  at 192 s will mostly skip, not repeat.

### Long answers are shaped to fit — Phase 9, Block 3

Each question declares `shareSeconds`, the most of the film its answer gets,
agreed with the owner on 2026-10-12: identity answers 5 s each, the greatest
lesson 45 s (its cold open counts against it), the closing message 30 s,
every other answer 22 s. The life-advice editor (version 6) fits each answer
to its share with `shapeAnswer` (`packages/editors/src/shaping.ts`):

- **Within its share, or with no word times: untouched.** A short answer is a
  good short answer. Every film made before Block 2 has no word times, so all
  five real films still cut byte-identically.
- **Over its share: tighten, then choose.** Pauses over 1.2 s come out first
  (often enough on their own, every word kept). Then the strongest whole
  sentences are kept in the order they were said: the opening, the phrase
  marked as the point, the conclusion; restarts full of "um" and "you know"
  go first. The first thought is kept whole even when it alone is over.
- **Never mid-word, never mid-thought.** A cut only falls in silence ingest
  measured; the unit that can be kept or dropped is one or more whole
  sentences starting and ending in that silence. Sentences said without a
  pause between them stay together.
- **Pieces are placed as their own beats** joined by a cut; the scale cycle
  gives each the next framing, so a cut inside an answer reads as a punch-in.
  The question card goes on the first piece, the insert on the longest.
- **Notes say what happened**, e.g. `"love_lesson": 82 s shaped to 22 s
  (share 22 s): kept 6 of 20 sentences` — in the compose log for now; Block 5
  shows them beside the preview.
- **An optional answer does not lengthen the film** (`sharesFor`): when the
  bonus is given, every share shrinks so the total stays the required
  answers' total (owner's choice, 2026-10-12).
- **Checked:** a film of ten 82-second answers (14 minutes said, bonus
  included) cuts to 3:38 — inside the 3:30–3:50 target — and passes the
  validator.
- Changing a share must come with an editor version bump: compose's hash does
  not include template content.

### Words have times now — Phase 9, Block 2

- **Transcription runs whisper twice** (`media/whisper.ts`): the untimed pass
  decides the words, because asking for timestamps changes what whisper
  writes (one take lost all its punctuation; another turned a full stop into
  a comma and gained an extra "like"); a second, timed pass
  (`--max-len 1 --split-on-word`) lends them times, matched word by word
  (`attachTimings`, a longest common subsequence). Stored as
  `selection.words`; `TRANSCRIBE_RECIPE` 2. About 2–4 s per answer here.
- **The editor corrects the times against ingest** (`alignToRuns` in
  `@film/editors`): whisper says which stretch of speech each word was in,
  ingest's stretches say when. Whisper alone put 10 of 40 words of a real
  take, and 35 of 77 of a synthetic one, in silence; after, none. The test
  takes (`packages/editors/test/takes/`) keep those takes' times and
  punctuation with every word swapped for a neutral one: the repository is
  public, and they are recordings of a person. A word in a
  gap goes by punctuation — a sentence's last word to the stretch before, its
  first to the stretch after.
- **Phrases** (`phrasesOf`): split at `.?!` and at pauses of 700 ms or more,
  each marked whether it ends a sentence. The units Block 3 will choose from.
  On the recorded take, every sentence comes out whole.
- **Captions use the times** (life-advice editor version 5). Each piece shows
  the words said inside it — which fixes the greatest lesson's main part,
  which used to squeeze the cold open's words back in at its start.
- **Existing films are untouched.** Transcription never overwrites words it
  wrote, so no film made before this has `words`, and version 5 cuts those
  byte-identically (checked on all five real films). New takes get times. A
  backfill could re-transcribe old takes; none is written.

### An editor per film type — Phase 9, Block 1

Proposal: `docs/proposal/phase-9-editors.md`. The edit that used to be the
pipeline's (`compose/plan.ts`, ~1,000 lines of life-advice beats) is now
`@film/editors`: an `Editor` is `{ id, version, edit(input) }`, each template
names one (`editor: "life-advice"`), and `editorFor(template)` finds it. The
compose stage gathers what was recorded, asks the editor, validates and
stores; it knows no film type.

- **Nothing changed in any film.** Five real films in the dev database and six
  synthetic ones were cut by the old code first and by the new package after:
  byte-identical. The dispatcher plans no compose for any of them, because the
  editor's `version` (4) goes into compose's hash under the old `recipe` key
  with the old value.
- **`toolkit.ts`** holds what any editor needs: the contiguous timeline,
  captions over measured speech, grid rounding that never overruns media,
  question-card timing, unused-asset notes. `life-advice/edit.ts` holds the
  beats, moved unchanged; more moves to the toolkit as a second editor needs it.
- **Golden cuts are checked in** (`packages/editors/test/golden/`). A change
  that alters a film fails the test: bump the editor's version, run
  `UPDATE_GOLDEN=1 pnpm test packages/editors`, and review the diff.
- Still named for life-advice in shared code: the render composition's id
  (`"LifeAdvice"`) and font family. Cosmetic.
### Every recording has a length now — Phase 8

Each question and filmable slot declares `take: { goodFrom, goodTo, max }`
(seconds) in its template; `@film/templates/take` holds the type and the zone
logic, as its own entry point so the browser does not load every template's
copy. While recording, a timer across the bottom of the picture shows the
good range and says "Aim for…", "Good length · stop when ready", "Plenty", and
in the last seconds "Stops in 0:06"; at `max` the recording stops by itself
and says so. A take under `goodFrom` gets the length that works suggested,
with Again to hand and Keep still allowed. `validateTemplate` refuses a
backwards range, and a test requires one on every recorded step.

Life-advice's numbers were proposed by Claude from each step's coaching and
are the owner's to adjust (`life-advice/v1.ts`, above `questions`). They are
capture-only, so changing them re-cuts no film. Uploaded files are not
checked for length yet.

### A film can be deleted — after Phase 8

- **Delete this film**, quiet at the bottom of the overview, the unapproved
  preview and the failed-film page, behind a sheet that says it is for good.
  Deletes the project row (everything else cascades from it), then the whole
  `projects/<id>/` storage prefix, then goes home.
- **Which films:** draft, capturing, awaiting approval, failed
  (`DELETABLE_STATUSES`). Never approved, rendering or delivered. Refused while
  processing, because the worker is writing files for it that would be left
  behind; it can be deleted once the preview is ready or it fails. The status
  is checked in the DELETE itself, so a film handed over between the page
  loading and the press is not deleted.
- **Queued jobs for a deleted film skip** (`claimStage` → `gone`, on the
  insert's foreign key) instead of failing four times.
- A preview or thumbnail stage already running when its film is deleted can
  still write one file afterwards. It sits under a prefix nothing points to.
### Every tap answers at once — Phase 8, after Block 3

The owner, on `pnpm web`: Continue and Home "take forever", with nothing on
screen to say anything is happening.

- **Most of the wait is the dev server.** Measured the same walk both ways:
  `next dev` 0.3–2.7 s per tap warm and up to 11 s on a page's first visit;
  a production build 30–260 ms. `next dev` compiles on demand and never
  prefetches. **`pnpm site`** runs a production build on :3300, built into
  `.next-site` so it sits beside `pnpm web` without taking it down. Turbopack
  was tried and cannot resolve this repo's `.js`-spelled imports.
- **Feedback within a frame, everywhere** (`app/NavProgress.tsx`): a bar across
  the top and `data-pending`/`aria-busy` on the tapped link, from one capture
  listener rather than per link. `<Button pending>` keeps its colour and shows
  a spinner. Both wait 120 ms, so a fast answer flashes nothing. Continue,
  Keep and Start this film hold their spinner until the next screen arrives
  (`useNavigate`, not a transition's `isPending`, which ends at `push`).
  `pnpm perf` "feedback" went from equal-to-arrival to 10–15 ms on every tap,
  dev and production.
- **Skeletons for home and the film page**, beside the wizard (see the
  invariant). The cost: once a skeleton has shown, React holds the real page
  back until 300 ms have passed, so on a fast machine those two arrive at
  ~330 ms instead of 80–170 ms. On a phone network, or the dev server, the
  page takes longer than that anyway.

### The preview plays smoothly — Phase 8, Block 3

- **Preview copies** (`stages/preview.ts`, migration 0008 → `assets.preview_key`):
  a stage of its own, like thumbnails. From the normalised file: 720p H.264,
  CRF 26 capped at 2 Mbit/s, a keyframe every second, 96 kbit/s AAC, same
  frames at the same times; photos at 1600 px. The render never uses them.
  Dispatched for every ingested asset with a picture, during capture too;
  never blocks compose. A real film's 17 assets: 111 MB → 13.7 MB, ~1.6 s each.
- **Player only:** `MediaSequence` premounts picture and sound two seconds
  early (in a render it is the old `layout="none"` sequence — golden frames
  unchanged); video, answers, question audio and photos pause the Player
  while loading. The music bed does not hold the picture.
- **Preview URLs last three hours** (were fifteen minutes), signed in parallel.
- **Measured** in headless Chrome at 8 Mbit/s / 40 ms against a production
  build of main, on a real film: 0 video stalls in 45 s of playback (main 13),
  8.5 MB downloaded (main 16.1); after a jump to the middle, picture moving in
  1.8 s, where main showed no picture data for over ten seconds while its
  clock ran on. The branch's clock restarts ~1 s later than main's after a
  jump, because it waits for what it is about to show.
- **Existing films:** the dispatcher makes copies for active projects when the
  worker runs; delivered films keep playing the normalised files, which still
  work.

### Recording without waiting — Phase 8, Block 2

`CaptureProvider` (`projects/[id]/layout.tsx`) owns the camera and the
upload queue for the whole film, above the overview and the wizard:

- **One camera, kept between questions.** The first recording step of a
  visit asks ("Turn on the camera"); after that each recording step opens
  live, so Record starts at once and the person sees their framing first.
  It is let go 1.5 s after a screen is done with it and stopped when the tab
  is hidden. Allowed-ness is remembered per tab (sessionStorage).
- **Uploads in the background.** Keep and continue never waits. One take at
  a time, retried after 2, 6 and 15 s, then "Try again" in the bar and on the
  step; "leave site?" while anything is pending; Make my film waits.
  `UploadStatus` shows it in the bar and on the overview.
- **Bounded takes:** 5 Mbit/s video, 128 kbit/s audio, one-second chunks.
- **Checked** with Chrome's fake camera: Record → recording 17 ms, Stop →
  Keep usable 83 ms, the same camera on the next question, the camera off
  while a take is watched back and on the overview, a dropped connection
  retried and recovered. On a production build Continue moved on 5 of 5, and
  the overview tap measured the same as main (median 172 ms vs 164).
- **Not yet proven on a phone:** a real camera's bitrate, Safari's handling
  of a stream kept between screens, and a phone being locked mid-take.

### Moving through the site is fast now — Phase 8, Block 1

Proposal and measurements: `docs/proposal/phase-8-performance.md`. Every tap
in the wizard lands in about 30–110 ms on a production build, from 160–780 ms
on `main` (`pnpm perf`, the two run alternately).

- **Auth is verified locally.** `getClaims()` checks the session token's ES256
  signature against the cached public key; `getUser()` asked the auth server
  and waited 200–535 ms, up to three times per tap. `sessionClaims`,
  `currentUser`, `sessionIdentity`, `accessToProject` and `loadWalkthroughView`
  are cached per request. Only a pending address still goes to the auth
  server, and only for an identity with no proved one. Trade-off accepted by
  the owner: a revoked token stays valid until it expires (≤ 1 hour). It needs
  asymmetric signing keys on the hosted project; with a shared secret
  `getClaims` quietly falls back to `getUser`.
- **The wizard frame is a layout**, `projects/[id]/(wizard)/layout.tsx`. It
  works out the bar for every screen (`frameMapOf`) and `WizardFrame` picks
  its entry from the URL, because a layout is not re-rendered between its
  pages. Saves revalidate the film's path, which refreshes it.
- **Continue redirects from the save action** (`submitDetail(…, then)`, only
  ever within the same film).
- **The film player is loaded only on the preview** (`FilmPlayer`, via
  `next/dynamic`): the film page went from 224 KB to 128 KB first load.
- **`pnpm perf`** times each wizard tap against a running server. Point it at
  a production build: `next dev` never prefetches.

### Polish and proof — Phase 7, Block 7

- **Accessibility:** axe-core 4.10 run in a real browser on every screen that
  does not need a finished film; the three findings (footer contrast, an
  unnamed progressbar, typed steps with no h1) are fixed and re-run clean.
  A "Skip to content" link is first in the tab order everywhere.
- **Phone states:** uploads report progress ("Saving — 62%") via
  XMLHttpRequest; closing the tab mid-upload raises the browser's own
  warning; the wizard says "You are offline" when it is; the next step is
  prefetched.
- **`pnpm screens`** writes every screen at 375px and 1280px to
  `out/screens/`, driving the installed Chrome through playwright-core. It is
  a review surface, not a test — nothing is compared. It presses Start once
  per viewport, so each run leaves two anonymous films in the dev database.
- **iOS Safari** renders the landing page correctly on an iPhone 17
  simulator (iOS 26.2). The walk-through itself was not driven: the simulator
  tool needs the owner's "Let Claude use it", and the simulator was showing an
  Apple Account password prompt that is the owner's to answer. Live camera
  recording on a real iPhone is still unproven.

### Every screen is Porch now — Phase 7, Blocks 4, 5 and 6

- **Home** is a landing page signed out (hero with the product drawn in its
  own components, how it works, three promises, FAQ from `product.ts`) and a
  library with films (a Continue / Ready-to-make card, then film cards with a
  poster thumbnail and a status in words). The #20 rule stands: anyone
  without an account still gets the explanation.
- **The chooser** draws each template as a feature card from data, including
  a new optional `Template.pitch` (summary, best for, you will need).
- **After capture:** a plain-words "making the first cut" page, the preview
  with the player as the hero and "Approve and make my film", notes named
  after their step and worded like the overview, a success card with
  Download, a failure page that no longer mentions an email nobody sends,
  and branded not-found and error pages.
- **Accounts:** one `AuthShell` frame for sign in (Password / Email me a
  link as a segmented control), a new `/account` page behind the header
  avatar, the password screens and the save sheet.
- Screen styles for parts 5 and 6 live in `app/styles/`.

Walked end to end on 2026-10-11 against local GoTrue and the real worker:
sign in by link, a film filled from a complete film's rows, Make, the making
page turning into the preview on its own, notes, Approve, "Making your film"
without a reload, delivered, "Your film is ready", download 206.

**Storage is R2 here, not local disk** (`R2_*` is set in `.env`), so test
films leave objects in the `films` bucket — see "A second R2 bucket" in Next.

### Capture is a wizard now, wearing Porch — Phase 7, Blocks 2 and 3

The owner chose the **Porch** brand (white, Ember #D92B4B, Plus Jakarta Sans)
and a **wizard with an overview** in place of the hub-only flow.

- **Design system:** tokens in `apps/web/app/globals.css`, components in
  `apps/web/src/ui` (Radix Dialog under the Sheet), every piece rendered at
  `/design`. The legacy class names were re-pointed at the tokens, so screens
  not yet redesigned (home, sign-in, preview) already wear the brand.
- **The wizard:** Start → the first chapter's intro → one step per screen →
  Keep and continue → … → the overview with Make my film. `/projects/[id]`
  while capturing is the overview; `/chapter/[chapterId]` is an intro;
  `/step/[stepId]` is a step; `/continue` goes wherever the film is up to.
- **Nothing about position is stored.** `nextStop` in `@film/templates`
  works out the next screen from what is done, every time, with tests — so a
  reload, another device and Back all agree. Skip and Keep go to the same
  place, because the step being left is never a candidate.
- **Never trapped:** Back, and "All steps" (a sheet listing every step,
  each a link) on every screen, with Save and leave.
- Chapters gained an optional `prepare` list for their intros. The four
  life-advice lists are new copy the owner has not read yet.

Not walked: live camera recording. The Browser pane blocks the camera; the
recording code is unchanged from the version proven on Chrome. Photo upload,
typed steps, skip, the sheet, the intros and the overview were walked at
375px and 1280px.

### A finished film needs an account — Phase 7, Block 1

Capture is still anonymous: pressing Start costs nothing. But the anonymous
identity used to own the film all the way to the download, so whoever held
that browser could watch it with nobody signed in. Now:

- **`accessToFilm` (@film/db)** answers owner / needs-account / none. An
  anonymous owner is enough while a project is `draft` or `capturing`, and not
  after. Every page, route and action that asked `accessToProject` inherits it
  — `/delivery`, `/download` and `/api/media` are 404 for an anonymous holder
  of a handed-over film.
- **"Make my film" is the gate.** `startTheFilm` returns `needsAccount` and the
  button opens the save sheet, prefilled with the address given in capture.
  The link carries `make=<project>`, and `/auth/callback` hands the film over
  when it is opened — one click from inbox to "Putting your film together".
- **The owner's own film is a save sheet, never a 404.** Films handed over
  before this existed (two in the dev database) show "Save your film to watch
  it".
- The password door is beside the link in the sheet, but its confirmation does
  not carry `make`: somebody who takes it lands home and presses the button
  again.

Every film now passes through an email, so **custom SMTP is a launch
blocker**. Design and the remaining blocks: `docs/proposal/phase-7-product-and-design-system.md`.

### The film is as long as what somebody actually said

The template was written for a four-minute film and the first real customer
recorded two minutes of answers. A fixed structure cut against that produces
long holds on photographs and a film that feels padded — the material is the
problem the edit has to solve, not something to compensate for.

- **`editing.adaptiveSpeechMs: { lean, rich }`** in the template declares what
  it is built on. `composeFilm` measures the speech it was actually given,
  positions it between those two numbers, and every duration comes from a
  declared range at that position. The numbers are the template's, not
  invented in the compose code.
- **A template that has not declared it gets no guess.** `speechAppetite`
  returns `undefined` rather than a number the customer would be shown as
  though the template had said it.
- **`DURATION_OUTSIDE_TARGET` only warns when it is worth warning.** Too long
  always; too short only when there was enough speech to have made a longer
  film. A short film made from short answers is the correct film.
- **Coaching happens during capture, not after**, because that is the only
  moment anyone can act on it. `spokenVerdict` compares an answer to the
  MEDIAN OF THAT PERSON'S OTHER ANSWERS — somebody whose whole conversation is
  brief is having a brief conversation, not making a mistake — and speaks only
  below a hard floor or far below their own middle. The hub shows total speech
  so far. Tone was the whole risk: "never feeling trapped" is one of the four
  things this product has to feel like.

### The hub stopped downloading the film to draw its thumbnails

`docs/proposal/phase-6-hub-performance.md` has the measurements. Every card was
drawn from the customer's ORIGINAL — a 7 MB photograph rendered 56 pixels wide,
a whole interview take opened as a `<video>` — and a fresh signature on every
render meant the browser cache could never hit, so it came down again on every
visit and every window focus.

- **`assets.thumbnail_key` and a `thumbnail` stage.** Measured on one real
  film: **105.2 MB → 157 KB** across seventeen cards.
- **A card draws the thumbnail or a grey square, never the original.** Falling
  back would leave exactly the films whose ingest is already cached slow for
  ever.
- **Signed URLs round their signing clock to a five-minute window**
  (`SignedUrlOptions.stableForSeconds`), so a re-render hands the browser the
  same URL and the second load is free. Verified in a browser: 0 bytes, 1 ms.
  The TTL is unchanged — this is not a public bucket and not a long-lived URL.
  A stable URL alone buys nothing, so the object carries `Cache-Control` too.
- **Loading and signing are separate acts, and the types enforce it.**
  `loadWalkthroughView` returns storage keys and signs nothing;
  `withThumbnails` and `stepWithMedia` mint only what their page draws. A step
  sheet carried 35 bearer credentials to display one asset; it carries 2.
- **The thumbnail object is `thumb-v{recipe}.jpg`.** The version in the name is
  what stops a re-run being skipped; the recipe number in the input hash is
  what lets it run at all. Change both or change neither.

### What a browser-made film can and cannot do

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

`transcribe` is whisper.cpp, spawned like ffmpeg. Four things about it are
worth knowing before touching it:

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
- ~~Whether a keepsake supplied as a video should be used~~ — **answered
  2026-08-30.** It is used, in the same place a photograph would sit. The
  template promised `accepts: ["photo", "video"]` and compose looked only in
  `stills`, so the object was silently absent from the finished film.
- Whether the walk-through's sixteen pieces of coaching copy read the way the
  owner would say them. They are the highest-leverage strings in the product,
  and nobody but the owner can answer it.
- **Whether the length coaching sounds encouraging or like marking homework.**
  The rule is deliberately quiet — it speaks only below a hard floor or far
  below that person's own median — but it is the one place the product tells
  somebody their answer about their mother could be longer. Worth reading the
  actual sentences in `qcNoteOf` before a stranger does.
- **Two old test films have no media left in the object store.** Their hubs
  draw grey squares. Fine to delete; noted so nobody debugs it as a thumbnail
  fault.
