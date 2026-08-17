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
      estimatedSeconds: 60,
      guidance: {
        coaching:
          "Ask for the whole sentence — \"My name is Ada Lovelace\" — rather than " +
          "just the name. It has to stand on its own in the film.",
      },
    },
    {
      id: "identity_age",
      order: 2,
      text: "How old are you?",
      narrativeRole: "introduction",
      required: true,
      estimatedSeconds: 60,
      guidance: {
        coaching:
          "A full sentence again: \"I'm 94.\" The film's title is built from this " +
          "number, so it is worth hearing it said out loud.",
      },
    },
    {
      id: "identity_birth_year",
      order: 3,
      text: "What year were you born?",
      narrativeRole: "introduction",
      required: true,
      estimatedSeconds: 60,
      guidance: {
        coaching:
          "Let them add where, if they want to. The place a life started is " +
          "usually the first thing that makes a stranger lean in.",
      },
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
      estimatedSeconds: 90,
      guidance: {
        coaching:
          "This one is usually answered with a joke first. Let the joke land, " +
          "then wait — the real answer tends to arrive straight after it.",
      },
    },
    {
      id: "greatest_lesson",
      order: 5,
      text: "What is the greatest lesson life has taught you?",
      narrativeRole: "wisdom",
      required: true,
      estimatedSeconds: 120,
      guidance: {
        coaching:
          "The most important answer in the film — it opens it and it closes " +
          "it. Ask, then say nothing at all. The pause before someone answers " +
          "this is where the good version comes from.",
      },
    },
    {
      id: "advice_for_young_people",
      order: 6,
      text: "What advice would you give to younger people?",
      narrativeRole: "wisdom",
      required: true,
      estimatedSeconds: 90,
      guidance: {
        coaching:
          "If it comes out general — \"work hard\" — ask who they would say it " +
          "to. Advice aimed at one person is worth more than advice aimed at " +
          "everyone.",
      },
    },
    {
      id: "meaning_of_group",
      order: 7,
      text: "What does this family or group mean to you?",
      narrativeRole: "relationships",
      required: true,
      estimatedSeconds: 90,
      guidance: {
        coaching:
          "Name the group out loud when you ask — the family, the team, the " +
          "congregation. A specific question gets a specific answer.",
      },
    },
    {
      id: "love_lesson",
      order: 8,
      // Deliberately does not presume a spouse: works for a subject who never
      // married or outlived a partner, and asks for a lesson not a definition.
      text: "What have you learned about love?",
      narrativeRole: "love",
      required: true,
      estimatedSeconds: 90,
      guidance: {
        coaching:
          "Learned, not defined. If they start describing what love is, ask " +
          "when they found that out.",
      },
    },
    {
      id: "closing_message",
      order: 9,
      // Presupposes an answer — "is there anything…" invites "not really" —
      // and produces direct address to camera, which a closing message needs.
      text: "What would you like to say to whoever watches this?",
      narrativeRole: "closing",
      required: true,
      estimatedSeconds: 90,
      guidance: {
        coaching:
          "Ask them to look straight down the lens for this one, and to talk " +
          "to whoever is watching in twenty years. It is the last thing anyone " +
          "hears in the film.",
      },
    },
    {
      id: "bonus_interviewer",
      order: 10,
      text: "What do you think of {{interviewerName}}, your {{interviewerRelationship}}?",
      narrativeRole: "bonus",
      required: false,
      estimatedSeconds: 90,
      guidance: {
        ask: "Ask them what they think of you",
        coaching:
          "Optional, and usually the funniest thing in the film. Ask it as " +
          "yourself, not as an interviewer.",
      },
    },
  ],

  questionPrompt: {
    defaultMode: "live-interviewer",
    supportedModes: ["live-interviewer", "recorded-interviewer", "text-only"],
    answerGapMs: 200,
  },

  photoSlots: [
    {
      id: "photo_early",
      label: "An earlier photo",
      required: true,
      estimatedSeconds: 60,
      guidance: {
        ask: "Add a photo of the person from another time",
        coaching:
          "Younger, or just years ago. Seeing them at a different age is what " +
          "makes the film feel like a life rather than an interview. A phone " +
          "photo of an old print works — lay it flat, no flash.",
        examples: ["A wedding photo", "Them in their twenties", "Holding a baby"],
      },
    },
    {
      id: "photo_personality",
      label: "A photo that shows their personality",
      required: true,
      estimatedSeconds: 60,
      guidance: {
        ask: "Add a photo that is unmistakably them",
        coaching:
          "Not the tidy portrait — the one where they are doing the thing they " +
          "are known for, or pulling the face everybody imitates.",
        examples: ["Mid-laugh", "In the garden", "Wearing the hat"],
      },
    },
    // "Group" may mean family, friends, coworkers, teammates, a congregation,
    // a club, or another important community.
    {
      id: "photo_group",
      label: "A meaningful group photo",
      required: true,
      estimatedSeconds: 60,
      guidance: {
        ask: "Add a photo of them with their people",
        coaching:
          "Family, friends, a team, a congregation — whoever the group is that " +
          "the earlier answer was about. Everyone in frame is better than " +
          "everyone in focus.",
        examples: ["A christmas table", "The whole team", "Four generations"],
      },
    },
  ],

  videoSlots: [
    {
      id: "video_environment",
      label: "A place or detail connected to them",
      required: false,
      estimatedSeconds: 60,
      guidance: {
        ask: "Film somewhere that belongs to them",
        coaching:
          "Ten quiet seconds, no talking, phone held still and level. Their " +
          "kitchen, the workshop, the view from the chair they always sit in.",
        examples: ["The kettle going", "Hands on a workbench", "The garden gate"],
      },
    },
    {
      id: "video_group",
      label: "A group moment",
      required: true,
      estimatedSeconds: 60,
      guidance: {
        ask: "Film them with other people",
        coaching:
          "Ten seconds of a room happening. Don't direct it — a table talking " +
          "over each other is worth more than everybody waving at the camera.",
      },
    },
    {
      id: "video_personality",
      label: "A candid moment",
      required: true,
      estimatedSeconds: 60,
      guidance: {
        ask: "Film them being themselves, not answering anything",
        coaching:
          "This is what the film opens on, before a word is spoken. Ten " +
          "seconds of them making tea, telling a story, laughing at someone.",
      },
    },
  ],

  optionalSlots: [
    {
      id: "keepsake",
      label: "A meaningful or funny object",
      required: false,
      estimatedSeconds: 60,
      accepts: ["photo", "video"],
      guidance: {
        ask: "Add an object that means something",
        coaching:
          "A photo or a short video, either is fine. Objects carry stories " +
          "that people are too modest to tell about themselves.",
        examples: ["A war medal", "The recipe card", "A terrible mug"],
      },
    },
  ],

  /**
   * The typed answers the film needs, worded like everything else the customer
   * reads. These are cards in the hub, not a form on the way in — "Who is this
   * film for?" sits next to "Add a photo of the person from another time", and
   * neither feels like signing up for something.
   */
  details: [
    {
      id: "subjectName",
      kind: "text",
      required: true,
      target: "subject",
      // Most people call their grandmother what everyone calls her; the one
      // who says "Nana" changes it on the optional step below.
      prefills: ["displayName"],
      estimatedSeconds: 10,
      guidance: {
        ask: "Who is this film for?",
        coaching: "Their name, the way it should appear on screen.",
        examples: ["Ada Lovelace", "Grandpa Joe"],
      },
    },
    {
      id: "displayName",
      kind: "text",
      required: false,
      target: "subject",
      estimatedSeconds: 5,
      guidance: {
        ask: "What do you call them?",
        coaching:
          "Only if it is different from their name — the film signs off with " +
          "this word.",
        examples: ["Nana", "Pops"],
      },
    },
    {
      id: "age",
      kind: "number",
      required: true,
      target: "subject",
      estimatedSeconds: 5,
      guidance: {
        ask: "How old are they?",
        coaching: "The film's title is built from this number.",
      },
    },
    {
      id: "relationshipLabel",
      kind: "text",
      required: false,
      target: "subject",
      estimatedSeconds: 5,
      guidance: {
        ask: "What are they to you?",
        coaching: "One word, from your side of it.",
        examples: ["Grandmother", "Dad", "Oldest friend"],
      },
    },
    {
      id: "ownerEmail",
      kind: "email",
      required: true,
      target: "owner",
      estimatedSeconds: 15,
      guidance: {
        ask: "Where should we send it?",
        coaching:
          "The finished film goes to this address, and it is how you get back " +
          "to this page from another phone or another day.",
      },
    },
  ],

  /**
   * The walk-through. Four chapters, and the break between them is the point:
   * the interview needs two people in one room, the photographs and b-roll do
   * not, and nobody should be kept in a chair while someone hunts for a print.
   */
  capture: {
    chapters: [
      {
        id: "details",
        title: "The film",
        blurb:
          "A few quick answers before the camera comes out — who this is " +
          "about, and where the finished film should go.",
        steps: [
          { kind: "detail", fieldId: "subjectName" },
          { kind: "detail", fieldId: "displayName" },
          { kind: "detail", fieldId: "age" },
          { kind: "detail", fieldId: "relationshipLabel" },
          { kind: "detail", fieldId: "ownerEmail" },
        ],
      },
      {
        id: "story",
        title: "Their story",
        blurb:
          "Ten questions, answered to camera. Landscape, somewhere quiet, and " +
          "sit them near a window rather than in front of one. You ask, they " +
          "answer — you will not be heard in the finished film.",
        steps: [
          { kind: "question", questionId: "identity_name" },
          { kind: "question", questionId: "identity_age" },
          { kind: "question", questionId: "identity_birth_year" },
          { kind: "question", questionId: "longevity" },
          { kind: "question", questionId: "greatest_lesson" },
          { kind: "question", questionId: "advice_for_young_people" },
          { kind: "question", questionId: "meaning_of_group" },
          { kind: "question", questionId: "love_lesson" },
          { kind: "question", questionId: "closing_message" },
          { kind: "question", questionId: "bonus_interviewer" },
        ],
      },
      {
        id: "photographs",
        title: "Photographs",
        blurb:
          "Three photographs. These can wait for another day — you do not need " +
          "anyone sitting with you for this part.",
        steps: [
          { kind: "slot", slotId: "photo_early" },
          { kind: "slot", slotId: "photo_personality" },
          { kind: "slot", slotId: "photo_group" },
        ],
      },
      {
        id: "moments",
        title: "Moments",
        blurb:
          "Short pieces of film with no talking in them, used between the " +
          "answers. Ten seconds each is plenty.",
        steps: [
          { kind: "slot", slotId: "video_personality" },
          { kind: "slot", slotId: "video_group" },
          { kind: "slot", slotId: "video_environment" },
          { kind: "slot", slotId: "keepsake" },
        ],
      },
    ],
  },

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
