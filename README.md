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

## Status: Phase 1 complete

Phase 1 is a handwritten EDL rendered offline end to end. No accounts, uploads, transcription,
queues, storage or payments — those are Phases 2–8.

```bash
pnpm install
pnpm film        # generate fixtures → validate → render → normalise → verify
```

Produces `out/life-advice-fixture.mp4`: 3:34, 1440×1080, delivered at −14 LUFS / −1 dBTP.
Roughly 9 minutes at concurrency 1 under software GL. Zero network calls.

```bash
pnpm test        # 135 tests, including 23 golden frames
pnpm typecheck
pnpm fixtures    # regenerate synthetic media (add --force to overwrite)

UPDATE_GOLDENS=1 pnpm vitest run goldenFrames   # after an intended visual change
```

## Layout

```
packages/edl         Zod schemas + the validator, including visual, prompt and answer timelines.
packages/formats     Format registry (landscape-classic only).
packages/music       MusicTrack schema, track registry, cue sheets.
packages/templates   LIFE_ADVICE_V1 and text interpolation.
packages/render      Remotion composition, framing, captions, audio envelope.
scripts/             Fixture generator and the render pipeline.
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
