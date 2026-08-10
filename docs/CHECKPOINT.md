# Checkpoint — 2026-08-08

State after Phase 1, the real-media proof, and Blocks 1–3 of the production
pipeline. Written so a session with no conversational context can pick this up
from the repository alone.

`main` is at `2bb6db5`, with the download surface open as a branch on top of
it. Blocks 1, 2 and 3 are merged. Ten packages, two apps, 239 tests.

---

## Priority, stated by the owner

> Focus on making sure the product **works and can be used by many people**.
> Auth, saved user videos and a polished UI come later.

---

## What works today

**A film goes from recordings to a delivered file with nobody running a
script.** This is new in Block 3 and is the thing the previous checkpoint said
was missing.

```bash
pnpm install
pnpm db:up && pnpm db:migrate
cp .env.example .env && set -a && . ./.env && set +a

pnpm intake     # incoming/ -> object store + Postgres, then stops
pnpm worker     # takes it from there
pnpm web        # watch and approve at localhost:3200
```

Three environment variables are easy to get wrong and fail quietly:

- `STORAGE_ROOT` — the worker writes objects here and the web app reads them.
  If they disagree, the symptom is a blank preview with no error anywhere.
  `apps/web/.env.local` has its own copy and must match; use absolute paths.
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
| 3 — Browser capture | Not started. **Largest product risk.** |
| 4 — Transcription | Not started. Caption text is supplied at intake; word timings estimated. |
| 5 — Compose | Deterministic, storage-backed, appends edl_versions. No cue alignment, no LLM selection. |
| 6 — Preview and approval | Done. Player preview, warning gate, approval, download. **No auth.** |
| 7 — Production render | Done. Worker, dispatcher, reconciler, render, deliver. |
| 8 — Accounts and payment | Not started. Deliver sends no mail. |

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

**Deliver requires an approval for that exact cut.** A render row can exist
without one; delivering against it would send someone a film they never
watched. `deliverableFilm` re-establishes this with a join rather than trusting
a status column, because the download route is where the film reaches a person.

**The dispatcher and the runner share `MAX_ATTEMPTS`.** A runner that has given
up while the dispatcher keeps handing work out is a loop that looks like
progress.

---

## Hard-won details

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

---

## Open decisions

**Owed by the owner:** production music (three licensed instrumentals with
marked cue sheets), brand identity, real b-roll, approved caption and emphasis
styling. Mechanisms exist; values are placeholders.

**Known and deliberate gaps:**

- **No authentication.** The approver is the project owner and there is no
  session to check against, so anyone who can reach a project URL can approve
  its film. Not deployable as-is.
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

Roughly in order of how much they matter to "works for many people":

1. **Browser capture (Phase 3).** The largest product risk, and intake still
   assumes files already on disk. Nobody can start a film without a shell.
2. **Transcription (Phase 4).** Caption text is typed in at intake and word
   timings are estimated. This is the biggest quality gap in the output.
3. **Auth (Phase 8).** Needed before anything is exposed publicly — the
   download route is one more thing a project URL now grants.
4. **Delivery by email.** Deliver marks the project and says plainly that no
   mail provider is configured. A customer who closes the tab is not told.
5. **Re-render only what changed.** Segment caching keyed on content hash.
   379s per film is fine now and will not be at volume.

A different language would still not help: >99% of wall time is inside FFmpeg
and Chromium.
