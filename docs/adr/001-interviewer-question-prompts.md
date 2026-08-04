# ADR 001: Interviewer question prompts

**Status:** Accepted · 2026-08-03 · pre-launch

## Context

Life Advice is created by two people: an off-screen interviewer asks the authored questions and an
on-camera storyteller answers them. A project must also work when the two people record
asynchronously or when no interviewer audio is available.

No customer project exists yet, so the current `life-advice@1` and EDL `1.0` contracts may evolve
in place. Phase 1 remains the offline harness for the later application phases.

## Decision

Every project selects a default question-prompt mode, with a per-question text-only fallback:

1. `live-interviewer` — the question is a source range from the same interview take as the answer.
2. `recorded-interviewer` — the question is a dedicated, normalised audio asset bound to one
   question.
3. `text-only` — no question audio is emitted; the authored question is revealed on screen.

The EDL carries `promptSegments` as a third timeline alongside visual and storyteller-speech
segments. Each prompt carries deterministic word timings for the on-screen question. Recorded
prompts also carry an explicit source range. Music ducks under recorded prompts and answers, but
not under text-only prompts.

Question and answer audio never comes from the visual tree. `PictureOnlyVideo` stays muted and the
three audio routes remain `PromptTrack`, `SpeechTrack`, and `MusicBed`.

## Phase ownership

- **Phase 1 / engine:** schema, validation, deterministic rendering, synthetic fixtures and tests
  for all three modes.
- **Phase 2 / application foundation:** participants, project default mode, prompt assets and job
  records.
- **Phase 3 / capture:** live question-and-answer takes, one separate interviewer recording per
  question, text-only selection, retakes, fallback and save/resume.
- **Phase 4 / transcription and selection:** speaker attribution for live takes, question/answer
  source ranges, prompt word timings and storyteller-only answer selection.
- **Later phases:** preview, approval, payment and delivery consume the validated EDL without
  mode-specific branching.

## Invariants

- A prompt must reference a question in the pinned template.
- Live prompts reference an interview asset for the same question.
- Separately recorded prompts reference an audio asset for the same question.
- Text-only prompts cannot carry an asset or source range.
- Prompts do not overlap each other or storyteller speech.
- Every prompt has a later answer for the same question; live prompts and answers use the same take.
- The template-defined answer gap is enforced.
- Recorded source spans equal prompt durations and stay within their assets.
- Prompt captions are ordered and remain within the prompt boundary.
