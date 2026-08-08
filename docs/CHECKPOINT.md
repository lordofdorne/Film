# Checkpoint — 2026-08-08

State after Phase 1, the real-media proof, and Blocks 1 and 2 of the production
substrate. Written so a session with no conversational context can pick this up
from the repository alone.

`main` is at `f2c9365`. Nine packages, one app, 176 tests.

---

## Priority, stated by the owner

> Focus on making sure the product **works and can be used by many people**.
> Auth, saved user videos and a polished UI come later.

Read that as: connect the pipeline end to end and make it run unattended for
concurrent projects. Do not spend effort on login, account management or visual
design until a film can go from media to delivery without anyone running a
script by hand.

---

## What works today

```bash
pnpm film                              # synthetic fixture film  -> out/life-advice-fixture.mp4
pnpm project:build && pnpm film:real   # real recordings         -> out/life-advice-real.mp4
pnpm test                              # 176 tests
pnpm db:up && pnpm db:migrate          # local Postgres 16 on :55432
pnpm seed:real && pnpm web             # preview at localhost:3200
```

Two films have been rendered and verified: a 3:34 synthetic fixture and a 3:03
film cut from ten real recorded answers and four real photographs. Both deliver
at −14 LUFS / −1 dBTP, with verification that fails the render rather than
shipping out of tolerance.

The browser preview plays the real film and the approval flow works end to end
against Postgres.

| Phase | State |
|---|---|
| 1 — Handwritten EDL, validator, renderer | Complete |
| 2 — Ingest and QC | Partial. Normalisation, speech measurement, rotation. No HDR tonemapping, no QC metric collection in the pipeline, warnings only seeded. |
| 3 — Browser capture | Not started. Largest product risk. |
| 4 — Transcription | Not started. Caption text is hand-edited JSON; word timings estimated. |
| 5 — Compose | First slice. Deterministic and working. No cue/downbeat alignment, no LLM selection. |
| 6 — Preview and approval | **Done** (Block 2). Player preview, warnings, approval. No auth. |
| 7 — Production render | Substrate only (Block 1). No workers, nothing queued. |
| 8 — Accounts and payment | Not started. |

---

## The gap that matters

**Nothing connects.** Ingest, compose and render exist as hand-run scripts
against one hardcoded `project/real` directory. The database, queue and storage
exist but no code path uses them to move a project forward. Approval records a
decision and triggers nothing.

That is Block 3, and it is the whole of "works for many people":

1. A worker process that starts pg-boss, claims stages, records results, drains
   on SIGTERM, cleans temp in `finally`, and checks free disk before claiming
   media work.
2. Ingest, compose, render and deliver ported to stages that read and write
   through `@film/db` and `@film/storage` instead of the local filesystem.
3. The reconciler — a periodic sweep of `stage_executions` stuck in `running`
   past a threshold. This is what covers the case the queue cannot: the
   transaction committed but the queue insert never landed.
4. Approval enqueues the delivery-quality render.
5. An intake path so a project can be created without editing JSON by hand.

Everything needed for this already exists: `claimStage` / `completeStage` /
`failStage`, `hashInputs`, `findStalledStages`, `shouldRetry`, `enqueueStage`,
`STAGE_POLICY`, and the storage interface.

---

## Architecture

```
assets + validated EDL + template version + format  →  rendered film
```

The EDL is a versioned JSON document describing the whole film. Code renders
it; code does not decide it. Three independent timelines:

- `visualSegments` — picture. Overlaps only as a declared transition.
- `speechSegments` — the storyteller's voice plus word-level captions. Never
  overlaps itself.
- `promptSegments` — the interviewer's question, text with optional audio.
  Never overlaps an answer.

### Packages

| Package | Depends on | Role |
|---|---|---|
| `@film/edl` | **zod only** | Schemas and the validator. 44 rules. |
| `@film/formats` | — | Format registry (`landscape-classic`). |
| `@film/music` | zod | Track schema, registry, cue sheets, licensing model. |
| `@film/templates` | edl, formats, music | `LIFE_ADVICE_V1`, text interpolation. |
| `@film/render` | all above | Remotion composition, framing, captions, audio. |
| `@film/db` | zod, drizzle, pg | Data model, connections, stage execution, approvals. |
| `@film/queue` | db, pg-boss | Queue topology, payloads, per-stage policy. |
| `@film/storage` | zod, aws-sdk | Project-scoped object store: local disk and R2. |
| `apps/web` | most | Next.js preview and approval. |

Dependencies flow one way. `@film/edl` has **no package dependencies** — this
is load-bearing, not incidental.

`@film/render` has three entry points: `.` (everything, includes Root and its
JSON import attributes), `./project` (props builder, safe for Node scripts),
`./composition` (composition only, safe for Next).

---

## Invariants that must not be broken

**The validator runs before the renderer, and the renderer assumes validity.**
Every invariant lives in `packages/edl/src/validate/`. Nothing downstream
re-checks. A new rule goes there with a deliberately malformed fixture.

**Template rules are data, not code.** The validator never imports
`@film/templates`; conformance arrives in a `ValidationContext`. Its tests
prove it by inlining `life-advice@1` conformance rather than importing it.

**Audio doubling is unrepresentable.** `InterviewSegment` and `BrollSegment`
have no audio field and every object is `.strict()`, so unmuting picture is a
*parse error*. `PictureOnlyVideo` is the only module rendering a video element.
Three audio routes: `SpeechTrack`, `PromptTrack`, `MusicBed`. Do not add a
fourth — a boundary test enforces this.

**Determinism.** Every composition is a pure function of `(EDL, format, frame)`.
No `Math.random`, no `Date.now`, no external reads.

**Exactly-once is enforced by Postgres.** Claim the row, then work.
`UNIQUE NULLS NOT DISTINCT` — the nulls clause is required because
project-wide stages have a null `asset_id`.

**Preview is the same composition as delivery.** Not a second implementation.
`resolveSrc` passes absolute URLs through so the browser uses signed URLs and
the worker uses a public dir, from one codebase.

---

## Hard-won details

- **`delayRender` at module scope leaks.** A handle created outside a React
  render pass is never reconciled, and the watchdog kills the render at the
  timeout boundary after a thousand good frames.
- **Offthread video cache must be capped**, or ten 1080p sources push Chrome
  into swap and it stops executing JavaScript.
- **Silence detection must run on the original take, not the normalised one.**
  Normalisation lifts room tone above the gate.
- **Loudnorm's JSON is the *last* object in ffmpeg's stderr.**
- **Webpack needs `extensionAlias`** to map `./Foo.js` to `Foo.tsx` — required
  separately for Remotion (`scripts/webpack-override.ts`) and Next
  (`apps/web/next.config.ts`).
- **Fonts inline as data URIs** for the render; the font gate must be
  non-fatal in the Player, where fonts legitimately arrive late.
- **Music must be levelled off a normalised baseline** (`BED_TARGET_LUFS`).
  Gains tuned against a constant tone land 12–15 LU too quiet under real music.
- **pg-boss queues default to `policy: "standard"`**, which deduplicates
  nothing. `"short"` is required for singleton-key collapse.
- **One drizzle-orm across the workspace**, pinned by override. Two copies give
  type errors that read like code bugs but are package identity mismatches.
- **Tests must scope their deletes.** `stages.test.ts` once deleted from
  `projects`/`assets`/`users` unscoped and wiped the database.
- **Boundary tests should strip comments** before grepping, or prose mentioning
  `<Video>` fails the build and people learn to reword rather than think.

---

## Open decisions

**Owed by the owner:** production music (three licensed instrumentals with
marked cue sheets), brand identity, real fixture media, approved caption and
emphasis styling. Mechanisms exist; values are placeholders.

**Open in `docs/proposal/phase-1-proposal.md` §8:** eight questions. Three were
resolved and are in code — beat/question mapping, `overlayTextKey`, always-on
captions.

**Proceeded on my own proposal, reversible:** placeholder track at 75 bpm;
vendored OFL font; `fade` draws only the incoming segment.

**Known and deliberate:** `apps/web` has **no authentication**. The approver is
the project owner with no session. Anyone who can reach the app can approve any
project by URL. Acceptable locally, not deployable.

**Temp music:** `incoming/songs` holds a commercial recording used as a scratch
bed, registered `usage: "temp-track"`. The validator refuses it unless the
caller opts into unlicensed music, so it cannot reach a customer. Replace
before launch.

---

## Scaling analysis

Per-film marginal cost is estimated well under $1 — render CPU is not the
constraint. Reliability and burst behaviour are.

1. **Preview is the `<Player>`** — done in Block 2. Decouples latency from
   render cost.
2. **Re-render only what changed** — segment caching keyed on content hash.
   Not built.
3. **Chunk renders across workers** — turns film length into a scaling
   parameter and fixes the Chrome memory ceiling. Not built.

A different language would not help: >99% of wall time is already inside FFmpeg
and Chromium. The only credible candidate is a Rust rasterizer compiled to
native and WASM to keep preview parity — months of work, not warranted.

---

## Next

**Block 3 — pipeline workers.** Scope in "The gap that matters" above. This is
the block that makes the product usable by many people.

Deliberately not next: renderer optimisation, auth, UI design.
