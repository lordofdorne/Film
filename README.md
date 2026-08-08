# Life Advice

A template engine that turns a guided, interviewer-led conversation plus personal photos and short
supplementary videos into a polished short documentary. Questions can use a live off-screen
interviewer, a separate interviewer recording, or timed text only.

**Not a general AI video editor.** Each film type is an authored template; the engine is generic.
The first — and the only one until it works well — is `life-advice@1`.

> The edit is a versioned JSON document, not application code.
>
> ```
> assets + validated EDL + template version + format → rendered film
> ```

The selection model may choose transcript word ranges. It does not render video, choose visual
styling, or redesign the film. **The template owns the edit.**

---

## Status

The pipeline runs end to end, unattended. Drop recordings in, get a film out.

```bash
pnpm install
pnpm db:up && pnpm db:migrate    # local Postgres 16 on :55432
cp .env.example .env             # then: set -a; . ./.env; set +a

pnpm intake                      # incoming/ -> object store + Postgres
pnpm worker                      # ingest -> compose; then again after approval
pnpm web                         # watch and approve at localhost:3200
```

Intake uploads the originals and writes the rows. The worker's dispatcher reads
the database, works out what each project needs next, and queues it. Compose
leaves the project in `awaiting_approval`; approving in the browser requests a
delivery render, which the worker picks up on its next tick and delivers.

Nothing chains stage to stage. Every step is derived from rows, which is what
makes a drained or rebuilt queue cost one tick of latency and nothing else.

### The offline path

Still works, still has no dependencies at all — no Postgres, no queue, no
network. It is the fastest feedback loop in the project and the harness that
keeps the render path testable.

```bash
pnpm film            # synthetic fixtures -> out/life-advice-fixture.mp4
pnpm project:build   # incoming/ -> project/real/{edl,manifest,subject}.json
pnpm film:real       # render project/real -> out/life-advice-real.mp4
```

```bash
pnpm test        # 216 tests, including 23 golden frames
pnpm typecheck
pnpm fixtures    # regenerate synthetic media (add --force to overwrite)

UPDATE_GOLDENS=1 pnpm vitest run goldenFrames   # after an intended visual change
```

Tests for `@film/db`, `@film/queue` and `@film/pipeline` run against a **real**
Postgres via Docker. The guarantee they rest on — `UNIQUE NULLS NOT DISTINCT` —
is a property of Postgres, not of our code, and no mock can verify it.

## Where things run

| Process | What it does |
|---|---|
| `pnpm intake` | Uploads originals, writes project and asset rows, exits. |
| `pnpm worker` | Claims stages, runs them, dispatches and reconciles. Run as many as you like. |
| `pnpm web` | Preview and approval at `localhost:3200`. **No authentication yet.** |

Exactly-once comes from a unique constraint in Postgres, not from there being
one worker. Scaling out is starting more of them.

**When you containerise the worker, node must be PID 1.** `pnpm worker` runs it
under two wrappers, and SIGTERM stops at the outermost one — the drain handler
never fires and every deploy becomes a hard kill after the grace period, with
in-flight renders recorded as failures rather than as cancellations. Use
`node dist/main.js` as the entrypoint, or `exec` into it.

## Layout

```
packages/db          Drizzle schema, three-role connections, stage execution.
packages/queue       pg-boss topology, job payloads, per-stage policy.
packages/storage     Project-scoped object store: local disk and R2.
packages/pipeline    What each stage does, plus the dispatcher and reconciler.
packages/edl         Zod schemas + the validator, including visual, prompt and answer timelines.
packages/formats     Format registry (landscape-classic only).
packages/music       MusicTrack schema, track registry, cue sheets.
packages/templates   LIFE_ADVICE_V1 and text interpolation.
packages/render      Remotion composition, framing, captions, audio envelope.
apps/worker          The process that runs stages. Thin on purpose.
apps/web             Next.js preview and approval.
scripts/             Intake, migrations, fixture generator, offline render.
sample/              The handwritten EDL, its asset manifest, and subject data.
docs/proposal/       Phase design record, including the open questions.
docs/adr/            Accepted cross-phase product and architecture decisions.
```

Dependencies flow one way: `edl → (zod)`, `templates → edl, formats, music`, `render → all`.

## Three things worth knowing before changing anything

**The validator runs before the renderer, and the renderer assumes validity.** Every invariant —
timeline contiguity, lip-sync agreement, speaker collision, caption bounds, template conformance —
is checked in `packages/edl/src/validate`. Nothing downstream re-checks. If you add a rule, add it
there and add a malformed fixture for it.

**Template rules are data, not code.** The validator never imports `@film/templates`; conformance
arrives as a `ValidationContext`. This is what makes the promise that a second template needs zero
engine changes true rather than aspirational. Keep it that way.

**Audio doubling is prevented by making it unrepresentable.** `InterviewSegment` and `BrollSegment`
have no audio field and both are strict, so an EDL that unmutes picture is a parse error.
`PictureOnlyVideo` is the only module that renders a video element and exposes no volume prop.
Storyteller answers come from `SpeechTrack`; off-screen questions come from `PromptTrack`; music
comes from `MusicBed`. Keep those three routes explicit and separate.

## Determinism

Every composition is a pure function of `(EDL, format, frame)` — no `Math.random`, no `Date.now`,
no external reads. Variation is resolved upstream and stored in the EDL. The font is a pinned file
inlined as a data URI rather than a system stack, because `-apple-system` renders different glyphs
on macOS and in a Linux container.

Byte-identical MP4s are not a goal. Deterministic frame composition is.

## Open questions

Eleven design questions remain open in [`docs/proposal/phase-1-proposal.md`](docs/proposal/phase-1-proposal.md) §8.
Three were resolved and are reflected in the code: the beat/question mapping (two questions added),
`overlayTextKey`, and the always-on caption policy.

Still outstanding and worth answering before Phase 2: production music (three licensed
instrumentals with marked cue sheets), brand identity, real fixture media, and approved caption and
emphasis styling. The mechanisms exist; the values are placeholders.
