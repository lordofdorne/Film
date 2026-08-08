# Checkpoint — 2026-08-07

State of the project after Phase 1, the real-media proof, and Block 1 of the
production substrate. Written so a session that has lost all conversational
context can pick this up from the repository alone.

---

## Where things stand

**Working end to end, offline, today:**

```bash
pnpm film                          # synthetic fixture film  -> out/life-advice-fixture.mp4
pnpm project:build && pnpm film:real   # real recordings     -> out/life-advice-real.mp4
pnpm test                          # 170 tests
pnpm db:up && pnpm db:migrate      # local Postgres for the substrate tests
```

Two films have been rendered and verified: a 3:34 synthetic fixture and a 3:03
film cut from ten real recorded answers and four real photographs. Both deliver
at −14 LUFS / −1 dBTP with verification that fails the render rather than
shipping out of tolerance.

**Phase status:**

| Phase | State |
|---|---|
| 1 — Handwritten EDL, validator, renderer | Complete |
| 2 — Ingest and QC | Partial. Normalisation, speech measurement, rotation. No HDR tonemapping, QC metrics or warning surface. |
| 3 — Browser capture | Not started. Largest product risk. |
| 4 — Transcription | Not started. Caption text is hand-edited JSON; word timings are estimated. |
| 5 — Compose | First slice. Deterministic, working. No cue/downbeat alignment, no LLM selection. |
| 6 — Preview and approval | Remotion Studio only, fixture film only. |
| 7 — Production render | Local only. Block 1 substrate exists; no workers yet. |
| 8 — Accounts and payment | Not started. |

---

## Architecture in one page

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

A single mutually-exclusive segment list cannot express "interview audio
continues while a photo is on screen", which is most of what this form is.

### Packages

| Package | Depends on | Role |
|---|---|---|
| `@film/edl` | **zod only** | Schemas and the validator. 44 rules. |
| `@film/formats` | — | Format registry (`landscape-classic`). |
| `@film/music` | zod | Track schema, registry, cue sheets, licensing model. |
| `@film/templates` | edl, formats, music | `LIFE_ADVICE_V1`, text interpolation. |
| `@film/render` | all | Remotion composition, framing, captions, audio. |
| `@film/db` | zod, drizzle, pg | Data model, connections, stage execution. |
| `@film/queue` | db, pg-boss | Queue topology, payloads, stage policy. |
| `@film/storage` | zod, aws-sdk | Project-scoped object store. |

Dependencies flow one way. `@film/edl` sits at the bottom with **no package
dependencies** — this is load-bearing, not incidental.

---

## Invariants that must not be broken

**The validator runs before the renderer, and the renderer assumes validity.**
Every invariant lives in `packages/edl/src/validate/`. Nothing downstream
re-checks. A new rule goes there, with a deliberately malformed fixture.

**Template rules are data, not code.** The validator never imports
`@film/templates`; conformance arrives in a `ValidationContext`. This is what
makes "a second template requires zero engine changes" true rather than
aspirational. The validator tests prove it by inlining `life-advice@1`
conformance instead of importing it.

**Audio doubling is unrepresentable.** `InterviewSegment` and `BrollSegment`
have no audio field and every schema object is `.strict()`, so an EDL that
unmutes picture is a *parse error*. `PictureOnlyVideo` is the only module that
renders a video element and exposes no volume prop. Three separate audio
routes: `SpeechTrack`, `PromptTrack`, `MusicBed`. Do not add a fourth.

**Determinism.** Every composition is a pure function of `(EDL, format, frame)`.
No `Math.random`, no `Date.now`, no external reads. The font is pinned and
inlined as a data URI because `-apple-system` renders different glyphs on macOS
than in a Linux container.

**Exactly-once is enforced by Postgres.** Claim the stage row, then do the work.
`UNIQUE NULLS NOT DISTINCT` — the nulls clause is required because project-wide
stages have a null `asset_id` and Postgres would otherwise treat each as
distinct.

---

## Hard-won details that will bite if forgotten

- **`delayRender` at module scope leaks.** A handle created outside a React
  render pass is never reconciled against Remotion's bookkeeping, so the
  watchdog kills the render at the timeout boundary after a thousand good
  frames. The font is registered via CSS with a data URI and no gate.
- **Offthread video cache must be capped.** Uncapped, ten 1080p sources push
  Chrome into swap and it stops executing JavaScript entirely.
- **Silence detection must run on the original take, not the normalised one.**
  Loudness normalisation lifts room tone above the gate, and every clip comes
  back "speaking" from the first frame to the last.
- **Loudnorm's JSON is the *last* object in ffmpeg's stderr**, not the first.
- **Webpack needs `extensionAlias`** to map `./Foo.js` to `Foo.tsx`. It is the
  fourth runtime in this repo and the only one that needs telling.
- **Fonts must be inlined as data URIs**, or a page recycle mid-render refetches
  them and can hang.
- **Music must be levelled off a normalised baseline.** Gains tuned against a
  constant-amplitude tone land 12–15 LU too quiet under real, dynamic music.
- **pg-boss queues default to `policy: "standard"`**, which deduplicates
  nothing. `"short"` is required for singleton-key collapse.

---

## Open decisions

**Owed by the product owner:** production music (three licensed or commissioned
instrumentals with marked cue sheets), brand identity, real fixture media,
approved caption and emphasis styling. Mechanisms exist; values are
placeholders.

**Open in `docs/proposal/phase-1-proposal.md` §8:** eight questions remain.
Three were resolved and are reflected in code — the beat/question mapping (two
questions added), `overlayTextKey`, and the always-on caption policy.

**Proceeded on my own proposal, reversible:** placeholder track at 75 bpm rather
than 72; vendored OFL font; `fade` draws only the incoming segment.

---

## Scaling analysis (summary)

Per-film marginal cost is estimated well under $1 — render CPU is *not* the
constraint. What breaks a service like this is reliability and burst
behaviour, not throughput.

Three decisions determine whether it scales:

1. **Preview must be the `<Player>`, never a render.** Decouples perceived
   latency from render cost entirely.
2. **Re-render only what changed.** Segment-level caching keyed on content
   hash turns edit iteration from O(film) into O(change).
3. **Chunk renders across workers.** Turns film length into a horizontal
   scaling parameter and fixes the Chrome memory ceiling structurally.

A different language would not help. Over 99% of wall time is already inside
FFmpeg and Chromium. The only credible candidate is a Rust rasterizer compiled
to native and WASM to preserve preview parity — months of work to replace a
browser's layout engine, and not warranted now.

---

## Next

**Block 1** — this substrate — is in review as PR #4.

**Block 2** — preview and approval via `<Player>` in Next.js. This is where
scalability is actually won and the first thing demoable to someone else.

**Block 3** — containerised render worker, chunked, with segment caching.

Deliberately *not* next: optimising the renderer. Taking work out of Chrome is
a real 3–5× lever (72.6% of frames are interview-plus-caption) but it trades
away preview parity, which is what makes Block 2 possible.
