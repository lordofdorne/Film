import type { Template } from "../types.js";

/**
 * life-advice@1 — a short legacy interview film centred on a person sharing
 * memories, relationships, values, humour and advice. Intimate, warm,
 * reflective, lightly humorous, personal. Never corporate.
 *
 * This object is immutable configuration. A version already used by a project
 * is NEVER mutated — changes ship as life-advice@2.
 */
const config: Template = {
  id: "life-advice",
  version: 1,
  displayName: "Life Advice",

  formatIds: ["landscape-classic"],
  defaultFormatId: "landscape-classic",
  targetDurationMs: { min: 210_000, max: 230_000 },

  structure: [
    "opening-context",
    "cold-open",
    "main-title",
    "identity",
    "longevity",
    "greatest-lesson",
    "advice-for-younger-people",
    "relationships",
    "love",
    "closing-message",
    "keepsake-or-group-photo",
    "end-title",
    "optional-bonus",
    "dedication",
  ],

  /**
   * Every beat maps to exactly one question. `range: 2` marks a second, later
   * excerpt of an answer already used earlier; it appears once, for the
   * cold-open device, so no line is heard twice.
   */
  beatSources: {
    "opening-context": { kind: "slot", slotId: "video_personality" },
    "cold-open": { kind: "question", questionId: "greatest_lesson", range: 1 },
    "main-title": { kind: "title", textKey: "mainTitle" },
    identity: {
      kind: "questions",
      questionIds: ["identity_name", "identity_age", "identity_birth_year"],
    },
    longevity: { kind: "question", questionId: "longevity" },
    "greatest-lesson": { kind: "question", questionId: "greatest_lesson", range: 2 },
    "advice-for-younger-people": { kind: "question", questionId: "advice_for_young_people" },
    relationships: { kind: "question", questionId: "meaning_of_group" },
    love: { kind: "question", questionId: "love_lesson" },
    "closing-message": { kind: "question", questionId: "closing_message" },
    "keepsake-or-group-photo": {
      kind: "slot",
      slotId: "keepsake",
      fallbackSlotId: "photo_group",
    },
    "end-title": { kind: "title", textKey: "endTitle" },
    "optional-bonus": { kind: "question", questionId: "bonus_interviewer", optional: true },
    dedication: { kind: "title", textKey: "closing" },
  },

  /**
   * Fixed sequence. Changing these after launch requires a new template
   * version. Nine required + one optional means the customer records ten
   * takes, which is the strongest argument for save-and-resume in capture.
   */
  questions: [
    {
      id: "identity_name",
      order: 1,
      text: "What is your name?",
      narrativeRole: "introduction",
      required: true,
    },
    {
      id: "identity_age",
      order: 2,
      text: "How old are you?",
      narrativeRole: "introduction",
      required: true,
    },
    {
      id: "identity_birth_year",
      order: 3,
      text: "What year were you born?",
      narrativeRole: "introduction",
      required: true,
    },
    {
      id: "longevity",
      order: 4,
      // The 100+ variant only fires when it is true of the subject. Most
      // subjects will not be centenarians.
      text: {
        default: "What is the secret to living a long life?",
        variants: [
          { when: "subject.age >= 100", text: "What is the secret to living past 100?" },
        ],
      },
      narrativeRole: "personality",
      required: true,
    },
    {
      id: "greatest_lesson",
      order: 5,
      text: "What is the greatest lesson life has taught you?",
      narrativeRole: "wisdom",
      required: true,
    },
    {
      id: "advice_for_young_people",
      order: 6,
      text: "What advice would you give to younger people?",
      narrativeRole: "wisdom",
      required: true,
    },
    {
      id: "meaning_of_group",
      order: 7,
      text: "What does this family or group mean to you?",
      narrativeRole: "relationships",
      required: true,
    },
    {
      id: "love_lesson",
      order: 8,
      // Deliberately does not presume a spouse: works for a subject who never
      // married or outlived a partner, and asks for a lesson not a definition.
      text: "What have you learned about love?",
      narrativeRole: "love",
      required: true,
    },
    {
      id: "closing_message",
      order: 9,
      // Presupposes an answer — "is there anything…" invites "not really" —
      // and produces direct address to camera, which a closing message needs.
      text: "What would you like to say to whoever watches this?",
      narrativeRole: "closing",
      required: true,
    },
    {
      id: "bonus_interviewer",
      order: 10,
      text: "What do you think of {{interviewerName}}, your {{interviewerRelationship}}?",
      narrativeRole: "bonus",
      required: false,
    },
  ],

  questionPrompt: {
    defaultMode: "live-interviewer",
    supportedModes: ["live-interviewer", "recorded-interviewer", "text-only"],
    answerGapMs: 200,
  },

  photoSlots: [
    { id: "photo_early", label: "An earlier photo", required: true },
    { id: "photo_personality", label: "A photo that shows their personality", required: true },
    // "Group" may mean family, friends, coworkers, teammates, a congregation,
    // a club, or another important community.
    { id: "photo_group", label: "A meaningful group photo", required: true },
  ],

  videoSlots: [
    { id: "video_environment", label: "A place or detail connected to them", required: false },
    { id: "video_group", label: "A group moment", required: true },
    { id: "video_personality", label: "A candid moment", required: true },
  ],

  optionalSlots: [
    {
      id: "keepsake",
      label: "A meaningful or funny object",
      required: false,
      accepts: ["photo", "video"],
    },
  ],

  text: {
    titleNoun: "stories",
    keys: {
      opening: "I interviewed my {{age}} year old {{relationshipLabel}}",
      mainTitle: "{{age}} years of {{titleNoun}}",
      // A literal callback of mainTitle, bookending the film.
      endTitle: "{{age}} years of {{titleNoun}}",
      closing: "love you {{displayName}}",
    },
    fallbacks: {
      opening: "I interviewed {{displayName}}, who is {{age}} years old",
    },
  },

  /** The editing grammar, as constants rather than prose in a components file. */
  editing: {
    openingContextMs: { min: 2_000, max: 5_000 },
    coldOpenMs: { min: 4_000, max: 8_000 },
    photoHoldMs: { min: 3_000, max: 5_000 },
    brollMs: { min: 2_000, max: 6_000 },
    /** Handles kept around a selected word range, where source bounds permit. */
    preRollHandleMs: 150,
    postRollHandleMs: 250,
    interviewScales: [1, 1.06, 1.1],
    /**
     * A 4:3 crop of 1920x1080 is 1440x1080 — exactly the output resolution — so
     * any punch-in above 1.0 upscales. 6-10% is invisible in practice; 4K
     * capture removes the compromise entirely.
     */
    maxInterviewUpscaleRatio: 1.1,
    minSubjectVisibleBeforeInsertMs: 2_000,
    returnToSubjectBeforeAnswerEndsMs: 2_000,
    defaultTransition: { type: "cut", durationMs: 0 },
    crossfadeMs: 600, // 18 frames
    fadeMs: 800, // 24 frames
    /** All authored boundaries are multiples of this, so every cut is exact. */
    authoringGridMs: 100,
  },

  conformance: {
    maxEmphasisPerFilm: 2,
    maxConsecutivePhotos: 2,
    requiredPhotoSlotIds: ["photo_early", "photo_personality", "photo_group"],
    requiredVideoSlotIds: ["video_group", "video_personality"],
  },

  audioDefaults: {
    /**
     * An offset from the bed's normalised -20 LUFS, not an absolute level.
     * Puts music roughly 6 LU under dialogue in the gaps — present without
     * competing — and roughly 18 LU under while anyone is speaking.
     *
     * Two earlier pairs (-18/-9, then -15/-12) were reported inaudible. Both
     * were tuned against a constant-amplitude tone; real music is dynamic and
     * needs the normalised baseline above to be levelled predictably.
     */
    musicGainDb: -6,
    duckDb: -12,
    duckAttackMs: 200,
    duckReleaseMs: 600,
  },

  /**
   * Restrained placeholder treatments. Swappable configuration — no component
   * reads a literal colour, size or weight. Replaced wholesale when brand
   * identity lands.
   */
  styling: {
    // A pinned font file, not a system stack: "-apple-system" renders
    // differently on macOS and in the Linux render container, which would make
    // every golden frame containing text fail.
    fontFamily: "LifeAdviceSans",
    captionPolicy: "all-speech",
    caption: {
      weight: 480,
      sizeVh: 0.045,
      tracking: -0.005,
      fill: "#F4F1EC",
      // Captions sit over photos and b-roll for roughly a third of the film,
      // so legibility against a bright image is a correctness property.
      shadow: "0 2px 18px rgba(0,0,0,0.62)",
      maxLines: 2,
      bottomInsetVh: 0.1,
    },
    question: {
      weight: 420,
      sizeVh: 0.055,
      tracking: -0.012,
      fill: "#F4F1EC",
      shadow: "0 2px 22px rgba(0,0,0,0.72)",
      revealFadeMs: 180,
    },
    title: {
      weight: 300,
      sizeVh: 0.085,
      tracking: -0.02,
      fill: "#F4F1EC",
      background: "#000000",
      revealPerWordMs: 220,
      revealFadeMs: 320,
    },
    overlay: {
      weight: 400,
      sizeVh: 0.038,
      tracking: -0.01,
      fill: "#F4F1EC",
      shadow: "0 2px 20px rgba(0,0,0,0.7)",
    },
    emphasis: {
      weight: 620,
      sizeVh: 0.062,
      tracking: -0.015,
      toneFill: {
        funny: "#F4E2B8",
        meaningful: "#F4F1EC",
        surprising: "#EBD9CE",
      },
      shadow: "0 2px 24px rgba(0,0,0,0.7)",
      riseMs: 260,
      holdScale: 1.04,
    },
  },

  /**
   * Declared intent. These three are not commissioned yet, so they do not
   * resolve in the registry; validateTemplate reports them as pending and
   * validateEdl only resolves the single track an EDL actually names.
   */
  musicOptions: ["life-advice-track-a", "life-advice-track-b", "life-advice-track-c"],
  defaultMusicTrackId: "life-advice-track-a",
};

export const LIFE_ADVICE_V1: Template = Object.freeze(config);
