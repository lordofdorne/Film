# Life Advice — Phase 1 Design Proposal

`life-advice@1` · landscape-classic · awaiting approval · **no code written**

Companion file: [`sample-edl.json`](./sample-edl.json)

---

## 1. Monorepo layout

```
Film/                                    # git init here (currently inside the ~ repo — must be fixed)
├── package.json                         # pnpm workspaces root, packageManager pinned
├── pnpm-workspace.yaml
├── turbo.json                           # task graph only; no remote cache in phase 1
├── tsconfig.base.json
├── .node-version                        # 22.4.0
├── .gitignore                           # fixtures/, out/, .turbo/, node_modules/, *.mp4, *.wav
├── docs/
│   ├── proposal/                        # this document + sample EDL
│   └── adr/                             # one file per locked decision
├── packages/
│   ├── edl/                             # @film/edl  — ZERO runtime deps except zod
│   │   ├── src/
│   │   │   ├── schema/
│   │   │   │   ├── primitives.ts        # MsInt, MsPositive, Unit, Id
│   │   │   │   ├── transition.ts
│   │   │   │   ├── visual.ts            # discriminated union on `kind`
│   │   │   │   ├── speech.ts
│   │   │   │   ├── audio.ts
│   │   │   │   ├── edl.ts               # EdlSchema, type EDL = z.infer<...>
│   │   │   │   ├── manifest.ts          # AssetManifest
│   │   │   │   └── selection.ts         # phase-4 LLM contract, defined now
│   │   │   ├── validate/
│   │   │   │   ├── index.ts             # validateEdl(input, ctx)
│   │   │   │   ├── general.ts
│   │   │   │   ├── visualTimeline.ts
│   │   │   │   ├── speechTimeline.ts
│   │   │   │   ├── crossTrack.ts
│   │   │   │   ├── music.ts
│   │   │   │   ├── conformance.ts       # driven by injected template data
│   │   │   │   └── issues.ts            # Issue { code, severity, path, message }
│   │   │   └── index.ts
│   │   └── test/
│   │       ├── fixtures/valid/*.json
│   │       ├── fixtures/invalid/*.json  # one file per invariant
│   │       └── *.test.ts
│   ├── formats/                         # @film/formats — Format type + registry
│   ├── music/                           # @film/music — MusicTrack, registry, cue + beat helpers
│   ├── templates/                       # @film/templates
│   │   └── src/
│   │       ├── types.ts                 # Template<TSubject>
│   │       ├── interpolate.ts           # {{token}} resolution + fallbacks + maxChars
│   │       ├── registry.ts              # TEMPLATE_REGISTRY
│   │       └── life-advice/v1.ts        # LIFE_ADVICE_V1 (frozen data)
│   ├── render/                          # @film/render — Remotion project
│   │   ├── src/
│   │   │   ├── Root.tsx
│   │   │   ├── FilmComposition.tsx
│   │   │   ├── segments/{Interview,Photo,Broll,TitleCard,BlackCard}.tsx
│   │   │   ├── video/PictureOnlyVideo.tsx   # the ONLY <Video>; muted, no volume prop
│   │   │   ├── audio/{SpeechTrack,MusicBed}.tsx, envelope.ts
│   │   │   ├── text/{Captions,EmphasisCaption,SequentialReveal}.tsx
│   │   │   ├── framing/{photoFraming,interviewFraming}.ts   # pure, unit-tested
│   │   │   ├── timing/{frames,windows}.ts
│   │   │   ├── assets/resolver.ts       # AssetResolver iface; LocalFileResolver in P1
│   │   │   └── theme.ts                 # font + caption/title style constants
│   │   ├── fonts/                       # vendored OFL font (see §8.7)
│   │   ├── test/{framing.test.ts, golden/*.png, goldenFrames.test.ts}
│   │   └── remotion.config.ts
│   └── config/                          # @film/config — shared tsconfig/eslint/vitest
├── scripts/
│   ├── generate-fixtures.ts             # FFmpeg synthetic media → fixtures/
│   └── render-fixture-film.ts           # generate → validate → render → normalize
├── fixtures/                            # GITIGNORED, generated
└── apps/                                # phase 2+ only: web/ (Next.js), worker/
```

**Dependency direction:** `edl → (zod)` · `formats → –` · `music → –` · `templates → edl, formats, music` · `render → edl, formats, templates, music`.

**Key architectural decision — validator dependency inversion.** `@film/edl` must not import `@film/templates`, or the "second template requires zero engine changes" goal is dead on arrival. Template-conformance rules therefore arrive as *data* in a `ValidationContext`:

```ts
type ValidationContext = {
  manifest: AssetManifest;
  format: Format;
  conformance: {                        // supplied by the template config
    maxEmphasisPerFilm: number;
    maxConsecutivePhotos: number;
    requiredPhotoSlotIds: string[];
    requiredVideoSlotIds: string[];
    questionIds: string[];
    interviewScales: number[];
    targetDurationMs: { min: number; max: number };
  };
  resolveMusicTrack: (id: string) => MusicTrack | undefined;
  allowPlaceholderMusic?: boolean;       // fixtures/tests only; default false
};

type Issue = { code: string; severity: "error" | "warning"; path: string; message: string };

function validateEdl(input: unknown, ctx: ValidationContext):
  | { ok: true;  edl: EDL; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };
```

---

## 2. Zod EDL schema

All objects are `.strict()` — unknown keys are rejected at every boundary.

```ts
import { z } from "zod";

/* ── primitives ──────────────────────────────────────────────────────── */
export const MsInt      = z.number().int().nonnegative();
export const MsPositive = z.number().int().positive();
export const Unit       = z.number().min(0).max(1);
export const Id         = z.string().min(1).max(128).regex(/^[A-Za-z0-9_\-:.]+$/);
export const TextKey    = z.string().min(1).max(64);

/* ── transitions ─────────────────────────────────────────────────────── */
export const TransitionSchema = z
  .object({
    type: z.enum(["cut", "crossfade", "fade"]),
    durationMs: MsInt,
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.type === "cut" && t.durationMs !== 0)
      ctx.addIssue({ code: "custom", message: "cut transitions must have durationMs === 0" });
    if (t.type !== "cut" && t.durationMs <= 0)
      ctx.addIssue({ code: "custom", message: `${t.type} transitions require durationMs > 0` });
  });

/* ── visual segments ─────────────────────────────────────────────────── */
const baseVisual = {
  id: Id,
  startMs: MsInt,
  durationMs: MsPositive,
  transitionIn: TransitionSchema,
  /* [APPROVED 2026-08-03, §8.4] optional template text key rendered over any
     segment using the reduced `overlay` treatment. Available on every kind. */
  overlayTextKey: TextKey.optional(),
};

export const TitleSegment = z.object({
  ...baseVisual,
  kind: z.literal("title"),
  textKey: TextKey,
  reveal: z.enum(["sequential", "fade"]),
}).strict();

export const BlackSegment = z.object({
  ...baseVisual,
  kind: z.literal("black"),
  textKey: TextKey.optional(),
}).strict();

export const InterviewSegment = z.object({
  ...baseVisual,
  kind: z.literal("interview"),
  assetId: Id,
  sourceInMs: MsInt,
  sourceOutMs: MsPositive,
  // NOTE: JSON 1.0 parses to 1. z.literal(1) is correct.
  scale: z.union([z.literal(1), z.literal(1.06), z.literal(1.1)]),
  // NO audio/volume field exists. See §7.
}).strict();

export const PhotoSegment = z.object({
  ...baseVisual,
  kind: z.literal("photo"),
  assetId: Id,
  slotId: Id,
  focalPoint: z.object({ x: Unit, y: Unit }).strict(),
  motion: z.enum(["in", "out", "panLeft", "panRight", "still"]),
  intensity: Unit,
  entry: z.enum(["cut", "insetExpand"]),
}).strict();

export const BrollSegment = z.object({
  ...baseVisual,
  kind: z.literal("broll"),
  assetId: Id,
  slotId: Id,
  sourceInMs: MsInt,
  sourceOutMs: MsPositive,
  // NO audio/volume field exists. See §7.
}).strict();

export const VisualSegmentSchema = z.discriminatedUnion("kind", [
  TitleSegment, BlackSegment, InterviewSegment, PhotoSegment, BrollSegment,
]);

/* ── speech segments ─────────────────────────────────────────────────── */
export const WordCaptionSchema = z.object({
  text: z.string().min(1).max(64),
  startMs: MsInt,
  endMs: MsPositive,
}).strict().refine(w => w.startMs < w.endMs, "caption startMs must be < endMs");

export const EmphasisSelectionSchema = z.object({
  startWord: z.number().int().nonnegative(),
  endWord: z.number().int().nonnegative(),
  tone: z.enum(["funny", "meaningful", "surprising"]),
}).strict().refine(e => e.startWord <= e.endWord, "emphasis startWord must be <= endWord");

export const SpeechSegmentSchema = z.object({
  id: Id,
  questionId: Id,
  assetId: Id,
  startMs: MsInt,
  durationMs: MsPositive,
  sourceInMs: MsInt,
  sourceOutMs: MsPositive,
  captions: z.array(WordCaptionSchema).min(1),
  emphasis: EmphasisSelectionSchema.optional(),
}).strict();

/* ── audio ───────────────────────────────────────────────────────────── */
export const EdlAudioSchema = z.object({
  musicTrackId: Id,
  musicStartMs: MsInt,          // offset INTO the track played at timeline 0
  musicGainDb: z.number().min(-60).max(0),
  duckDb: z.number().min(-30).max(0),
  beatGridMs: z.array(MsInt),   // frozen copy of the track's downbeats
}).strict();

/* ── document ────────────────────────────────────────────────────────── */
export const EdlSchema = z.object({
  version: z.literal("1.0"),
  projectId: Id,
  templateId: Id,               // generic, not a literal — see §8.1
  templateVersion: z.number().int().positive(),
  fps: z.literal(30),
  totalDurationMs: MsPositive,
  audio: EdlAudioSchema,
  visualSegments: z.array(VisualSegmentSchema).min(1),
  speechSegments: z.array(SpeechSegmentSchema).min(1),
}).strict();

export type EDL = z.infer<typeof EdlSchema>;
export type VisualSegment = z.infer<typeof VisualSegmentSchema>;
export type SpeechSegment = z.infer<typeof SpeechSegmentSchema>;

/* ── asset manifest (validator input, never part of the EDL) ─────────── */
export const AssetEntrySchema = z.object({
  id: Id,
  kind: z.enum(["interview", "photo", "video"]),
  questionId: Id.optional(),
  slotId: Id.optional(),
  durationMs: MsPositive.optional(),   // required for interview/video
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

export const AssetManifestSchema = z.object({
  assets: z.array(AssetEntrySchema).min(1),
}).strict();

/* ── phase-4 selection contract (schema only, no caller yet) ─────────── */
export const SelectionSchema = z.object({
  verdict: z.string().min(1).max(400),
  start_word: z.number().int().nonnegative(),
  end_word: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(1000),
  flag_review: z.boolean(),
}).strict().refine(s => s.start_word <= s.end_word);
```

### Validator rules beyond the schema

Everything in the brief, plus three additions I'm proposing:

| Code | Rule | Rationale |
|---|---|---|
| `TIME_NOT_FRAME_ALIGNED` (warning) | every `startMs`/`durationMs` on both timelines should be a multiple of 100 ms | at 30 fps, `frame = ms × 0.03` is an exact integer iff `ms % 100 === 0`. Non-aligned boundaries silently round and can collapse a short segment to zero frames. Caption word times are exempt (sub-frame caption boundaries are invisible). |
| `SEGMENT_TOO_SHORT` (error) | every segment ≥ 2 frames (67 ms) | a 1-frame segment can vanish under rounding |
| `BEAT_GRID_DIVERGENCE` (error) | `edl.audio.beatGridMs` must be strictly ascending and a subset of the resolved track's grid | the EDL carries a frozen copy for reproducibility; divergence means the registry was mutated |

Music rules: `track.durationMs >= musicStartMs + edl.totalDurationMs`; every cue within the track; `musicTrackId` resolves to a registry entry with a non-null `licenseRef` and `usage !== "creative-reference-only"` — the `placeholder-tone-bed` passes only when `ctx.allowPlaceholderMusic === true`.

---

## 3. `LIFE_ADVICE_V1`

```ts
export const LIFE_ADVICE_FORMAT = {
  id: "landscape-classic",
  width: 1440, height: 1080, aspectRatio: "4:3", fps: 30,
  safeInset: { top: 0.06, right: 0.06, bottom: 0.08, left: 0.06 },
  titleMaxChars: 48, captionScale: 1,
} as const;

export const LIFE_ADVICE_V1 = {
  id: "life-advice",
  version: 1,
  displayName: "Life Advice",
  formatIds: ["landscape-classic"],
  defaultFormatId: "landscape-classic",
  targetDurationMs: { min: 210_000, max: 230_000 },

  structure: [
    "opening-context", "cold-open", "main-title", "identity", "longevity",
    "greatest-lesson", "advice-for-younger-people", "relationships", "love",
    "closing-message", "keepsake-or-group-photo", "end-title",
    "optional-bonus", "dedication",
  ],

  /* [APPROVED 2026-08-03, §8.1] which question feeds each structural beat.
     `range: 2` marks a second, later excerpt of an answer already used earlier —
     it now appears exactly once, for the deliberate cold-open device (§8.11). */
  beatSources: {
    "opening-context":           { kind: "slot",     slotId: "video_personality" },
    "cold-open":                 { kind: "question", questionId: "greatest_lesson", range: 1 },
    "main-title":                { kind: "title",    textKey: "mainTitle" },
    "identity":                  { kind: "questions", questionIds: ["identity_name","identity_age","identity_birth_year"] },
    "longevity":                 { kind: "question", questionId: "longevity" },
    "greatest-lesson":           { kind: "question", questionId: "greatest_lesson", range: 2 },
    "advice-for-younger-people": { kind: "question", questionId: "advice_for_young_people" },
    "relationships":             { kind: "question", questionId: "meaning_of_group" },
    "love":                      { kind: "question", questionId: "love_lesson" },
    "closing-message":           { kind: "question", questionId: "closing_message" },
    "keepsake-or-group-photo":   { kind: "slot",     slotId: "keepsake", fallbackSlotId: "photo_group" },
    "end-title":                 { kind: "title",    textKey: "endTitle" },
    "optional-bonus":            { kind: "question", questionId: "bonus_interviewer", optional: true },
    "dedication":                { kind: "title",    textKey: "closing" },
  },

  /* [AMENDED 2026-08-03, §8.1] brief's eight questions verbatim, plus
     `love_lesson` and `closing_message`. 9 required + 1 optional = 10 takes. */
  questions: [
    { id: "identity_name",           order:  1, text: "What is your name?",
      narrativeRole: "introduction",  required: true },
    { id: "identity_age",            order:  2, text: "How old are you?",
      narrativeRole: "introduction",  required: true },
    { id: "identity_birth_year",     order:  3, text: "What year were you born?",
      narrativeRole: "introduction",  required: true },
    { id: "longevity",               order:  4,
      text: { default: "What is the secret to living a long life?",
              variants: [{ when: "subject.age >= 100",
                           text: "What is the secret to living past 100?" }] },
      narrativeRole: "personality",   required: true },
    { id: "greatest_lesson",         order:  5, text: "What is the greatest lesson life has taught you?",
      narrativeRole: "wisdom",        required: true },
    { id: "advice_for_young_people", order:  6, text: "What advice would you give to younger people?",
      narrativeRole: "wisdom",        required: true },
    { id: "meaning_of_group",        order:  7, text: "What does this family or group mean to you?",
      narrativeRole: "relationships", required: true },
    // NEW — deliberately does not presume a spouse; works for a subject who
    // never married or outlived a partner, and asks for a lesson not a definition.
    { id: "love_lesson",             order:  8, text: "What have you learned about love?",
      narrativeRole: "love",          required: true },
    // NEW — presupposes an answer ("is there anything…" invites "not really")
    // and produces direct address to camera, which a closing message needs.
    { id: "closing_message",         order:  9, text: "What would you like to say to whoever watches this?",
      narrativeRole: "closing",       required: true },
    { id: "bonus_interviewer",       order: 10,
      text: "What do you think of {{interviewerName}}, your {{interviewerRelationship}}?",
      narrativeRole: "bonus",         required: false },
  ],

  photoSlots:    [ /* photo_early, photo_personality, photo_group — verbatim */ ],
  videoSlots:    [ /* video_environment, video_group, video_personality — verbatim */ ],
  optionalSlots: [ /* keepsake — verbatim */ ],

  text: {
    titleNoun: "stories",
    keys: {
      opening:   "I interviewed my {{age}} year old {{relationshipLabel}}",
      mainTitle: "{{age}} years of {{titleNoun}}",
      endTitle:  "{{age}} years of {{titleNoun}}",   // [ADDITION — §8.2] deliberate callback
      closing:   "love you {{displayName}}",
    },
    fallbacks: {
      opening: "I interviewed {{displayName}}, who is {{age}} years old",
    },
    requiredTokens: {
      opening:   ["age", "relationshipLabel"],
      mainTitle: ["age", "titleNoun"],
      endTitle:  ["age", "titleNoun"],
      closing:   ["displayName"],
    },
  },

  editing: {
    openingContextMs:   { min: 2_000, max: 5_000 },
    coldOpenMs:         { min: 4_000, max: 8_000 },
    photoHoldMs:        { min: 3_000, max: 5_000 },
    brollMs:            { min: 2_000, max: 6_000 },
    preRollHandleMs:  150,
    postRollHandleMs: 250,
    interviewScales: [1, 1.06, 1.1],
    maxInterviewUpscaleRatio: 1.1,           // see §8.6
    minSubjectVisibleBeforeInsertMs: 2_000,
    returnToSubjectBeforeAnswerEndsMs: 2_000,
    defaultTransition: { type: "cut", durationMs: 0 },
    crossfadeMs: 600,                        // 18 frames
    fadeMs:      800,                        // 24 frames
    authoringGridMs: 100,                    // all boundaries are multiples of this
  },

  conformance: {
    maxEmphasisPerFilm: 2,
    maxConsecutivePhotos: 2,
    requiredPhotoSlotIds: ["photo_early", "photo_personality", "photo_group"],
    requiredVideoSlotIds: ["video_group", "video_personality"],
  },

  audioDefaults: {
    musicGainDb: -18,
    duckDb: -9,
    duckAttackMs: 200,
    duckReleaseMs: 600,
  },

  styling: {
    // placeholder treatments — swappable config, no component reads a literal
    fontFamily: "InterVariable",            // vendored OFL file, see §8.7
    // [APPROVED 2026-08-03, §8.10] every word of every speech segment is
    // captioned regardless of what the picture is doing.
    captionPolicy: "all-speech",            // "all-speech" | "interview-only" | "emphasis-only"
    caption:  { weightAxis: 480, sizeVh: 0.045, tracking: -0.005, fill: "#F4F1EC",
                shadow: "0 2px 18px rgba(0,0,0,0.55)", anchor: "bottom", maxLines: 2 },
    title:    { weightAxis: 300, sizeVh: 0.085, tracking: -0.02,  fill: "#F4F1EC",
                background: "#000000", anchor: "center",
                revealPerWordMs: 220, revealFadeMs: 320 },
    overlay:  { weightAxis: 400, sizeVh: 0.038, tracking: -0.01,  fill: "#F4F1EC",
                anchor: "topLeft" },
    emphasis: { weightAxis: 620, sizeVh: 0.062, tracking: -0.015,
                toneFill: { funny: "#F4E2B8", meaningful: "#F4F1EC", surprising: "#EBD9CE" },
                riseMs: 260, holdScale: 1.04 },
  },

  musicOptions: ["life-advice-track-a", "life-advice-track-b", "life-advice-track-c"],
  defaultMusicTrackId: "life-advice-track-a",

  musicReference: {
    title: "End of August", artist: "Noah Kahan", album: "The Great Divide",
    usage: "creative-reference-only", licensedAssetId: null,
  },
} as const;

export const TEMPLATE_REGISTRY = { "life-advice": { 1: LIFE_ADVICE_V1 } } as const;
```

`musicOptions` names three tracks that do not exist yet. `validateTemplate()` reports each unresolved option as a **warning** (`MUSIC_OPTION_PENDING`) and blocks only at launch-readiness check; `validateEdl()` resolves only the single `musicTrackId` actually referenced.

### Placeholder track

```ts
export const PLACEHOLDER_TRACK: MusicTrack = {
  id: "placeholder-tone-bed",
  title: "Placeholder Tone Bed",
  licensor: "generated",
  licenseRef: "PLACEHOLDER — not for production",
  assetKey: "fixtures/music/placeholder-tone-bed.wav",
  durationMs: 240_000,
  bpm: 75,                                   // [DEVIATION — §8.5] was 72
  beatGridMs: /* downbeats every 3200 ms, 0 … 236800 (75 bars) */,
  cues: { openingMs: 0, titleMs: 9_000, lifts: [56_000, 80_000, 141_000],
          resolutionMs: 169_000, endingMs: 192_000 },
  mood: ["placeholder"],
  available: false,
  usage: "fixture-only",
};
```

---

## 4. Sample EDL

See [`sample-edl.json`](./sample-edl.json) — 33 visual segments, 11 speech segments, 214 000 ms.

**Fixture asset manifest** (what `scripts/generate-fixtures.ts` must produce):

| Asset id | Kind | Bound to | Spec |
|---|---|---|---|
| `asset_iv_identity_name` | interview | `identity_name` | 1920×1080 · 30 fps · 90 s · H.264 |
| `asset_iv_identity_age` | interview | `identity_age` | ″ |
| `asset_iv_identity_birth_year` | interview | `identity_birth_year` | ″ |
| `asset_iv_longevity` | interview | `longevity` | ″ |
| `asset_iv_greatest_lesson` | interview | `greatest_lesson` | ″ |
| `asset_iv_advice` | interview | `advice_for_young_people` | ″ |
| `asset_iv_meaning_of_group` | interview | `meaning_of_group` | ″ |
| `asset_iv_love_lesson` | interview | `love_lesson` | ″ |
| `asset_iv_closing_message` | interview | `closing_message` | ″ |
| `asset_iv_bonus` | interview | `bonus_interviewer` | ″ |
| `asset_photo_early` | photo | `photo_early` | **1200×1600 portrait — deliberately low-res, triggers QC warning** |
| `asset_photo_personality` | photo | `photo_personality` | 3000×2000 landscape |
| `asset_photo_group` | photo | `photo_group` | 2400×2400 square |
| `asset_keepsake` | photo | `keepsake` | 2000×1500 |
| `asset_broll_environment` | video | `video_environment` | 1920×1080 · 12 s |
| `asset_broll_group` | video | `video_group` | 1920×1080 · 12 s |
| `asset_broll_personality` | video | `video_personality` | 1920×1080 · 12 s |
| — | music | — | 240 s stereo 48 kHz tone bed, 75 bpm |

Every synthetic video burns in **asset label + running source timecode + frame number** via `drawtext`, each on a distinct flat base colour, so a golden frame proves `sourceInMs` was honoured rather than merely that *something* rendered. Interview clips carry a speech-band warble (amplitude-modulated 200–700 Hz) so the ducking envelope is audible in the mezzanine.

**Subject data used by the sample:**

```json
{ "subjectName": "Eleanor Grace Whitfield", "displayName": "Nana", "age": 94,
  "relationshipLabel": "grandmother",
  "interviewerName": "Margaret", "interviewerRelationship": "granddaughter" }
```

Resolved titles (all within `titleMaxChars: 48`): `opening` → "I interviewed my 94 year old grandmother" (39) · `mainTitle`/`endTitle` → "94 years of stories" (19) · `closing` → "love you Nana" (13).

---

## 5. Timeline summary

### Structural beats vs. music cues

| ms | Beat | Cue | Lead visual |
|---|---|---|---|
| 0 | opening-context | `openingMs` 0 | `video_personality` b-roll + `opening` overlay |
| 4 000 | cold-open | — | interview, greatest_lesson (range 1) |
| **9 000** | main-title | **`titleMs` 9 000** | title card, sequential reveal |
| 14 400 | identity | — | 3 interview clips + `photo_early` |
| 30 600 | longevity | — | interview ×3 + `video_environment` |
| **56 000** | greatest-lesson | **`lifts[0]` 56 000** | `photo_personality` entry |
| **80 000** | advice-for-younger-people | **`lifts[1]` 80 000** | `photo_group` entry |
| 110 000 | relationships | — | interview + `photo_early` ⇄ `photo_personality` |
| **141 000** | love | **`lifts[2]` 141 000** | interview + `video_group` |
| **169 000** | closing-message | **`resolutionMs` 169 000** | interview |
| 181 400 | keepsake-or-group-photo | — | `keepsake` → `photo_group` → black |
| **192 000** | end-title | **`endingMs` 192 000** | title callback |
| 197 200 | optional-bonus | — | interview, bonus |
| 207 200 | dedication | — | "love you Nana" |
| 214 000 | end | — | — |

All six cue points land exactly on a segment start. Music track is 240 000 ms ≥ 214 000 ms ✓.

### Required slot placement

| Slot | Appearances |
|---|---|
| `photo_early` | 22 600 (4 s, insetExpand, in) · 121 400 (5 s, crossfade, in) |
| `photo_personality` | 56 000 (4 s, cut, panRight) · 125 800 (4.6 s, crossfade, panLeft) |
| `photo_group` | 80 000 (4.5 s, insetExpand, out) · 185 400 (4.6 s, crossfade, in) |
| `video_environment` | 44 600 (5 s) |
| `video_group` | 70 000 (5 s) · 153 000 (5 s) |
| `video_personality` | 0 (4 s, opening) · 96 500 (5 s) |
| `keepsake` | 181 400 (4.6 s, still, insetExpand) |

### Treatment coverage

interview ✓ · photo ✓ · b-roll ✓ · title ✓ · black ✓ · scales 1.0 / 1.06 / 1.1 ✓ · motions in / out / panLeft / panRight / still ✓ · entries cut / insetExpand ✓ · transitions cut / crossfade / fade ✓ · reveals sequential / fade ✓ · overlay text ✓ · emphasis ×2 (meaningful @ `s06`, funny @ `s09`) ✓ · photo-over-speech ✓ · b-roll-over-speech ✓ · return-to-subject-mid-answer ✓ · two-consecutive-photos boundary ✓.

---

## 6. Crossfade arithmetic

Worked from the sample, `v20 → v21 → v22 → v23` (interview → photo → photo → interview), the only run with back-to-back crossfades.

```
Rule:  current.startMs === previous.startMs + previous.durationMs - current.transitionIn.durationMs

v20_iv_group_a          start 110 000   dur 12 000   transitionIn cut       0   →  ends 122 000
v21_photo_early_b       transitionIn crossfade 600
                        start = 110 000 + 12 000 - 600 = 121 400   ✓ matches EDL
                        dur 5 000                                   →  ends 126 400
v22_photo_personality_b transitionIn crossfade 600
                        start = 121 400 + 5 000 - 600  = 125 800   ✓ matches EDL
                        dur 4 600                                   →  ends 130 400
v23_iv_group_b          transitionIn cut 0
                        start = 125 800 + 4 600 - 0    = 130 400   ✓ matches EDL
```

Overlap windows — the only places two visuals are simultaneously on screen:

```
121 400 – 122 000   v20 (interview) over v21 (photo)   600 ms = 18 frames
125 800 – 126 400   v21 (photo)     over v22 (photo)   600 ms = 18 frames
```

Guards:
- `600 ≤ min(prev.durationMs, own.durationMs)` → `600 ≤ min(12 000, 5 000)` ✓ and `600 ≤ min(5 000, 4 600)` ✓.
- Frame alignment: `121 400 × 0.03 = 3 642`, `122 000 × 0.03 = 3 660`, `125 800 × 0.03 = 3 774`, `126 400 × 0.03 = 3 792`, `130 400 × 0.03 = 3 912` — all exact integers, because every boundary is a multiple of 100 ms.
- Coverage: no gap and no undeclared overlap anywhere between 110 000 and 130 400.
- **Speech is untouched.** `s08_group` runs 110 200 → 139 800 continuously straight through both crossfades. The dissolves are a picture-layer opacity ramp only.

---

## 7. Preventing audio doubling between the two tracks

Six independent layers, ordered from "makes it impossible" to "catches it if it somehow happens":

1. **The field does not exist.** `InterviewSegment` and `BrollSegment` have no `audio`, `volume`, `gainDb`, or `muted` key, and every schema object is `.strict()`. An EDL that tries to unmute a picture segment fails parsing with `unrecognized_keys`. There is no representable state in which a visual segment produces sound.

2. **One video component, no escape hatch.** Every `interview` and `broll` segment renders through `PictureOnlyVideo`, the sole module permitted to import Remotion's `<Video>` / `<OffthreadVideo>`. It hardcodes `muted` and `volume={0}`, and its props type has no volume-shaped member. Segment components receive picture geometry only.

3. **One audio origin.** `<SpeechTrack>` maps `edl.speechSegments` and is the only place `<Audio>` appears outside `<MusicBed>`. Speech never travels through the visual tree, so a visual crossfade cannot ramp it — this is also why cross-dissolves are guaranteed not to dip speech.

4. **A lint/unit boundary test.** A Vitest case greps the built module graph and asserts that `<Video`, `<OffthreadVideo`, and `<Audio` appear in exactly `PictureOnlyVideo.tsx`, `SpeechTrack.tsx`, and `MusicBed.tsx`. Adding a fourth site fails CI. This is the rule that survives future contributors.

5. **A mutation test.** The offline end-to-end fixture renders twice: once normally, once with `PictureOnlyVideo` forced to `muted={false}`. The test asserts the second render's decoded speech-band energy exceeds the first by ≈ 6 dB and **fails if it does not** — i.e. it proves the detector works, so a green normal run is meaningful rather than vacuous.

6. **Physics as the backstop.** The lip-sync invariant forces the visual and speech source positions to agree within one frame. Doubling would therefore be phase-coherent, not a flam — a clean +6 dB on speech. That lands well outside the −14 LUFS / −1 dBTP delivery tolerance, and the post-render FFmpeg verification stage fails the render rather than shipping it.

The b-roll case is the same mechanism: `BrollSegment` has no audio field, so "source audio muted by default" is not a default at all — it is the only expressible behaviour. If ambience is ever wanted, it ships as an explicit new field in a new EDL version with a mandatory gain, never as an implicit default.

---

## 8. Remaining creative ambiguity

Numbered so you can answer by number. **1–4 are blocking-ish** (I made a choice to keep moving; if you disagree the sample EDL changes). 5–8 are decisions I made unilaterally and want on the record. 9–14 are open questions that do not block Phase 1.

**1. ✅ RESOLVED 2026-08-03 — two questions added to `life-advice@1`.** `love_lesson` ("What have you learned about love?", order 8) and `closing_message` ("What would you like to say to whoever watches this?", order 9), both required; `bonus_interviewer` moves to order 10. No beat now depends on an invented split of another answer. Consequences: the fixed question set is **10 questions, 9 required**, so a customer records ten takes — a real completion-rate risk for an elderly subject in one sitting, and the strongest argument for the save-and-resume behaviour in Phase 3. Fixture manifest grows to ten interview clips. Sample EDL `v24`/`v26`/`s09` now source `asset_iv_love_lesson` and `v27`/`s10` source `asset_iv_closing_message`; all four lip-sync overlaps re-derived and verified. *Question wording is still open to redline — changing it later needs `life-advice@2`.*

**2. `end-title` has no text key.** I added `endTitle`, identical to `mainTitle`, as a literal callback ("94 years of stories" bookending the film). Confirm the wording — a variant ("94 years, and counting") may read better.

**3. `dedication` vs `closing-message`.** I read `LIFE_ADVICE_TEXT.closing` ("love you {{displayName}}") as the **dedication card**, leaving `closing-message` as a spoken beat. Confirm.

**4. ✅ RESOLVED 2026-08-03 — `overlayTextKey` approved on `BaseVisual`,** available on every segment kind, rendered with the `styling.overlay` treatment. The film opens on a candid moving image with the line over it. Guard to enforce in review, since the field is now broadly available: overlay text is template config only (a `textKey`, never a literal), and a segment may not carry both `overlayTextKey` and its own `textKey` — the validator rejects that combination on `title` and `black` (`OVERLAY_TEXT_COLLISION`).

**5. Placeholder track bpm 72 → 75.** At 72 bpm a bar is 3 333.33 ms and downbeats never land on a frame, so beat-alignment assertions would be approximate on synthetic media. 75 bpm gives 800 ms beats / 3 200 ms bars / exactly 75 bars over 240 s, all frame-exact. Real licensed tracks won't cooperate — for those, compose snaps to the nearest downbeat *then* to the nearest frame, and the validator allows ±1 frame. The brief's cue times are unchanged. Say the word and I'll revert to 72.

**6. Punch-in on 1080p sources is upscaling.** A 4:3 crop of 1920×1080 is 1440×1080 — exactly the output resolution. So `scale: 1.06` and `1.1` upscale by 6 % and 10 %. Invisible in practice, but it means the "when source resolution permits" clause is never satisfied at 1080p. I set `maxInterviewUpscaleRatio: 1.1` to allow it. The real fix is 4K capture guidance in Phase 3. Confirm you're happy with ≤10 % upscale in the interim.

**7. A system font stack breaks golden-frame determinism.** `-apple-system` renders differently on your Mac and in the Linux render container; every golden frame with text would fail. I propose vendoring one OFL-licensed variable font (Inter) as the neutral Phase 1 placeholder, referenced from a single `styling.fontFamily` constant, swapped wholesale when brand identity lands. Font files are text-adjacent and OFL — committing them does not violate "no binary media".

**8. `fade` semantics.** I define `fade` as: the incoming segment ramps up from black over the overlap and **the outgoing segment is not drawn**. `crossfade` draws both. In the sample, every `fade` is adjacent to a title or black card, so the two definitions would look identical — but the code needs one answer. Related: I define `entry: "insetExpand"` as **ignored when `transitionIn.type !== "cut"`** (you cannot inset-expand out of a dissolve). Confirm both.

**9. `musicStartMs` semantics.** I read it as *offset into the track* played at timeline 0 (so cue at track time C appears at timeline `C − musicStartMs`). The sample uses 0. Confirm.

**10. ✅ RESOLVED 2026-08-03 — captions always on, all speech.** Every word of every speech segment is captioned regardless of what the picture is doing, recorded as `styling.captionPolicy: "all-speech"` so the alternatives remain swappable template config rather than a rewrite. Two consequences for the renderer: captions sit over photos and b-roll for roughly a third of this film, so the caption treatment must stay legible against a bright photo (hence the shadow in `styling.caption`, which needs a golden frame over `asset_photo_personality` specifically); and `<Captions>` reads only `edl.speechSegments`, never the visual track, which keeps it independent of what is on screen.

**11. Cold-open reuse.** I used a distinct, earlier range of `greatest_lesson` for the cold open and a later range for the greatest-lesson beat, so no line is heard twice. The bookend alternative — repeat the cold-open line at the end — is a different and also defensible film.

**12. `SpeechSegment` has one `assetId`, so "the first three answers assembled into one identity introduction" cannot be one segment.** The sample uses three consecutive speech segments (`s02`/`s03`/`s04`) with 600 ms and 600 ms of silence between them. Confirm that reads as one introduction to you.

**13. Missing bonus interviewer data.** When `interviewerName` or `interviewerRelationship` is absent, I omit the `optional-bonus` beat entirely and shorten the film. Alternative: keep the beat and use another answer. Confirm.

**14. The placeholder cue sheet puts `endingMs` at 192 000 with 22 s of film after it.** That's fine for a fixture, but real commissioned tracks should place `endingMs` at the dedication, not the end title. Worth specifying in the brief you give the composer.

**Not blocking, noted for later:** retention period length; whether warnings persist across take replacement; watermark design for the pre-payment render.

---

## Phase 1 exit criteria

`pnpm film` runs offline end to end: generate fixtures (idempotent, skipped if present) → validate the sample EDL against the manifest → `remotion render` the mezzanine → FFmpeg `loudnorm` analyse + normalise + verify (−14 LUFS, −1 dBTP) → write `out/life-advice-fixture.mp4`. Zero network calls. Then I show you the film and stop.
