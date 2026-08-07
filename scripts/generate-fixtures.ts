/**
 * Generates every piece of Phase 1 placeholder media into a gitignored
 * fixtures/ directory using FFmpeg. The GENERATOR is committed, the assets are
 * not — which keeps the repo free of binaries and makes fixtures reproducible
 * on any machine.
 *
 * Every synthetic video burns in an asset label, a running SOURCE timecode and
 * a frame number. That is what makes trimming verifiable: a golden frame shows
 * which moment of the source it came from, so a test can prove sourceInMs was
 * honoured rather than merely proving that something rendered.
 *
 *   pnpm fixtures          generate anything missing
 *   pnpm fixtures --force  regenerate everything
 *
 * Real fixture media replaces these later with no code changes.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const FIXTURES_DIR = join(ROOT, "fixtures");

const FORCE = process.argv.includes("--force");

/* ── shared media parameters ─────────────────────────────────────────── */

const FPS = 30;
/** Deliberately 16:9 so the 4:3 crop path is exercised by every render. */
const VIDEO_W = 1920;
const VIDEO_H = 1080;
const INTERVIEW_SECONDS = 90;
const BROLL_SECONDS = 12;

/**
 * DejaVu Sans ships with FFmpeg on most platforms; on macOS Homebrew builds it
 * is usually absent, so fall back to a system font. drawtext needs a real file.
 */
const FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
];

let cachedFont: string | undefined;
const findFont = async (): Promise<string> => {
  if (cachedFont !== undefined) return cachedFont;
  for (const path of FONT_CANDIDATES) {
    try {
      await stat(path);
      cachedFont = path;
      return path;
    } catch {
      /* try the next one */
    }
  }
  throw new Error(
    `no usable font for FFmpeg drawtext; looked in:\n  ${FONT_CANDIDATES.join("\n  ")}`,
  );
};

/* ── asset descriptions ──────────────────────────────────────────────── */

type InterviewSpec = { readonly id: string; readonly label: string; readonly hue: string };

/**
 * Ten interview clips, one per question — not the single clip the brief's
 * fixture table listed. Both cross-track invariants (lip-sync agreement and
 * no-speaker-collision) are untestable with only one assetId, and the product
 * records one answer per question anyway.
 */
const INTERVIEWS: readonly InterviewSpec[] = [
  { id: "asset_iv_identity_name", label: "Q1 NAME", hue: "0x1d3b53" },
  { id: "asset_iv_identity_age", label: "Q2 AGE", hue: "0x1f4657" },
  { id: "asset_iv_identity_birth_year", label: "Q3 BIRTH YEAR", hue: "0x21505a" },
  { id: "asset_iv_longevity", label: "Q4 LONGEVITY", hue: "0x235a5d" },
  { id: "asset_iv_greatest_lesson", label: "Q5 GREATEST LESSON", hue: "0x2a5f52" },
  { id: "asset_iv_advice", label: "Q6 ADVICE", hue: "0x356447" },
  { id: "asset_iv_meaning_of_group", label: "Q7 GROUP", hue: "0x44693d" },
  { id: "asset_iv_love_lesson", label: "Q8 LOVE", hue: "0x5c6d36" },
  { id: "asset_iv_closing_message", label: "Q9 CLOSING", hue: "0x74702f" },
  { id: "asset_iv_bonus", label: "Q10 BONUS", hue: "0x8a6f2c" },
];

const BROLL = [
  { id: "asset_broll_environment", label: "B-ROLL ENVIRONMENT", hue: "0x6b2d3c" },
  { id: "asset_broll_group", label: "B-ROLL GROUP", hue: "0x54305f" },
  { id: "asset_broll_personality", label: "B-ROLL PERSONALITY", hue: "0x2f3b6b" },
] as const;

/** One portrait, one landscape, one square, plus the keepsake. */
const STILLS = [
  {
    id: "asset_photo_early",
    label: "PHOTO EARLY (LOW RES)",
    width: 1200,
    height: 1600,
    hue: "0x7a6a55",
  },
  {
    id: "asset_photo_personality",
    label: "PHOTO PERSONALITY",
    width: 3000,
    height: 2000,
    hue: "0x4a6b6a",
  },
  { id: "asset_photo_group", label: "PHOTO GROUP", width: 2400, height: 2400, hue: "0x6b5a7a" },
  { id: "asset_keepsake", label: "KEEPSAKE", width: 2000, height: 1500, hue: "0x7a5a4a" },
] as const;

const MUSIC_SECONDS = 240;
const PROMPT_SECONDS = 5;

/**
 * Optional creative-reference source. When present, the fixture bed is the
 * first REFERENCE_MUSIC_CLIP_SECONDS of that file, looped to MUSIC_SECONDS so
 * the film is fully covered. The source itself is never committed (fixtures/
 * and *.mp3 are gitignored). Set REFERENCE_MUSIC_SRC to override the path.
 */
const REFERENCE_MUSIC_CLIP_SECONDS = 62;
const referenceMusicSource = (): string =>
  process.env.REFERENCE_MUSIC_SRC?.trim() ||
  join(FIXTURES_DIR, "music", "reference-source.mp3");

/* ── FFmpeg helpers ──────────────────────────────────────────────────── */

const esc = (text: string): string =>
  text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");

/**
 * Burned-in diagnostics: the asset label, a source timecode counting from
 * 00:00:00.00, and the frame number. Sized generously — these are read off a
 * downscaled golden frame.
 */
const diagnosticFilters = (label: string, font: string): string[] => [
  `drawtext=fontfile='${font}':text='${esc(label)}':x=(w-text_w)/2:y=h*0.12` +
    `:fontsize=64:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=18`,
  `drawtext=fontfile='${font}':timecode='00\\:00\\:00\\:00':r=${FPS}` +
    `:x=(w-text_w)/2:y=h*0.44:fontsize=96:fontcolor=white` +
    `:box=1:boxcolor=black@0.55:boxborderw=20`,
  `drawtext=fontfile='${font}':text='frame %{frame_num}':x=(w-text_w)/2:y=h*0.62` +
    `:fontsize=56:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=14`,
  // A moving element, so a still frame proves motion is being sampled.
  `drawbox=x='mod(t*220\\,w)':y=h*0.80:w=90:h=26:color=white@0.85:t=fill`,
];

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const ffmpeg = async (args: readonly string[], outPath: string): Promise<void> => {
  await mkdir(dirname(outPath), { recursive: true });
  try {
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, outPath], {
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`ffmpeg failed writing ${outPath}\n${detail}`);
  }
};

type Job = { readonly path: string; readonly build: () => Promise<void> };

/* ── generators ──────────────────────────────────────────────────────── */

const interviewJob = (
  spec: InterviewSpec,
  font: string,
  /** When true, speech audio is silent so a real music bed is not overlaid
   *  with the fixture warble. Captions and ducking still follow the EDL. */
  silentSpeech: boolean,
): Job => {
  const path = join(FIXTURES_DIR, "interview", `${spec.id}.mp4`);
  return {
    path,
    build: async () => {
      const filters = [
        `[0:v]${diagnosticFilters(spec.label, font).join(",")}[v]`,
      ].join(";");
      // Default: a speech-band warble (200-700Hz sweep) so ducking is audible
      // against the synthetic tone bed. With a real reference track, that
      // warble is the "weird sound" under every caption — use silence instead.
      const audioInput = silentSpeech
        ? `anullsrc=channel_layout=stereo:sample_rate=48000`
        : `aevalsrc='0.28*sin(2*PI*t*(200+250*(1+sin(2*PI*t*0.7))))*` +
          `(0.55+0.45*sin(2*PI*t*3.1))':s=48000:d=${INTERVIEW_SECONDS}`;
      await ffmpeg(
        [
          "-f", "lavfi",
          "-i", `color=c=${spec.hue}:s=${VIDEO_W}x${VIDEO_H}:r=${FPS}:d=${INTERVIEW_SECONDS}`,
          "-f", "lavfi",
          "-i", audioInput,
          "-filter_complex", filters,
          "-map", "[v]", "-map", "1:a",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000",
          "-t", String(INTERVIEW_SECONDS),
        ],
        path,
      );
    },
  };
};

const brollJob = (
  spec: (typeof BROLL)[number],
  font: string,
): Job => {
  const path = join(FIXTURES_DIR, "broll", `${spec.id}.mp4`);
  return {
    path,
    build: async () => {
      await ffmpeg(
        [
          // testsrc2 makes b-roll unmistakably distinct from the flat-colour
          // interview clips at a glance.
          "-f", "lavfi",
          "-i", `testsrc2=s=${VIDEO_W}x${VIDEO_H}:r=${FPS}:d=${BROLL_SECONDS}`,
          "-f", "lavfi",
          "-i", `sine=frequency=440:sample_rate=48000:duration=${BROLL_SECONDS}`,
          "-filter_complex",
          `[0:v]colorchannelmixer=rr=0.35:gg=0.35:bb=0.45,` +
            `drawbox=x=0:y=0:w=iw:h=ih:color=${spec.hue}@0.55:t=fill,` +
            `${diagnosticFilters(spec.label, font).join(",")}[v]`,
          "-map", "[v]", "-map", "1:a",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000",
          "-t", String(BROLL_SECONDS),
        ],
        path,
      );
    },
  };
};

const stillJob = (spec: (typeof STILLS)[number], font: string): Job => {
  const path = join(FIXTURES_DIR, "photo", `${spec.id}.jpg`);
  return {
    path,
    build: async () => {
      // A grid plus corner marks, so photo framing (focal point, motion,
      // intensity) is readable from a golden frame rather than guessed at.
      const grid =
        `drawgrid=w=iw/8:h=ih/8:t=2:c=white@0.20,` +
        `drawbox=x=8:y=8:w=iw-16:h=ih-16:color=white@0.55:t=6`;
      await ffmpeg(
        [
          "-f", "lavfi",
          "-i", `color=c=${spec.hue}:s=${spec.width}x${spec.height}`,
          "-vf",
          `${grid},` +
            `drawtext=fontfile='${font}':text='${esc(spec.label)}'` +
            `:x=(w-text_w)/2:y=h*0.44:fontsize=${Math.round(spec.width / 18)}` +
            `:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=16,` +
            `drawtext=fontfile='${font}':text='${spec.width}x${spec.height}'` +
            `:x=(w-text_w)/2:y=h*0.56:fontsize=${Math.round(spec.width / 26)}` +
            `:fontcolor=white:box=1:boxcolor=black@0.4:boxborderw=12`,
          "-frames:v", "1", "-q:v", "3",
        ],
        path,
      );
    },
  };
};

const musicJob = (): Job => {
  const path = join(FIXTURES_DIR, "music", "placeholder-tone-bed.wav");
  return {
    path,
    build: async () => {
      const source = referenceMusicSource();
      if (await exists(source)) {
        // Crop the reference to the first minute+2s, then loop until the bed
        // is long enough for the fixture film (and the registry duration).
        const clipPath = join(FIXTURES_DIR, "music", "reference-clip-62s.wav");
        await ffmpeg(
          [
            "-i", source,
            "-t", String(REFERENCE_MUSIC_CLIP_SECONDS),
            "-c:a", "pcm_s16le", "-ac", "2", "-ar", "48000",
          ],
          clipPath,
        );
        await ffmpeg(
          [
            "-stream_loop", "-1",
            "-i", clipPath,
            "-t", String(MUSIC_SECONDS),
            "-c:a", "pcm_s16le", "-ac", "2", "-ar", "48000",
          ],
          path,
        );
        return;
      }

      // A slow two-note bed at 75bpm. Not music; enough to hear the ducking
      // envelope open and close against speech.
      await ffmpeg(
        [
          "-f", "lavfi",
          "-i",
          /**
           * An A-minor drone in an audible register.
           *
           * The first version of this was two sine tones at 110Hz and
           * 164.81Hz. It measured correctly and was inaudible: laptop and
           * phone speakers barely reproduce 110Hz, and a bare sine has almost
           * no perceptual presence even when its RMS says otherwise. A
           * placeholder you cannot hear cannot tell you whether the ducking
           * envelope feels right, which is the only reason it exists.
           *
           * Root, fifth, octave and tenth, weighted so the fundamental
           * dominates, with a 16s swell so the bed moves under the edit.
           */
          `aevalsrc='` +
            `(0.10*sin(2*PI*t*220)+0.07*sin(2*PI*t*329.63)` +
            `+0.045*sin(2*PI*t*440)+0.025*sin(2*PI*t*659.25))` +
            `*(0.62+0.38*sin(2*PI*t*0.0625))` +
            `|(0.10*sin(2*PI*t*220.4)+0.07*sin(2*PI*t*329.2)` +
            `+0.045*sin(2*PI*t*440.6)+0.025*sin(2*PI*t*658.7))` +
            `*(0.62+0.38*sin(2*PI*t*0.0625+0.6))'` +
            `:s=48000:d=${MUSIC_SECONDS}`,
          "-c:a", "pcm_s16le", "-ac", "2", "-ar", "48000",
          "-t", String(MUSIC_SECONDS),
        ],
        path,
      );
    },
  };
};

const promptAudioJob = (): Job => {
  const path = join(FIXTURES_DIR, "prompt", "asset_prompt_closing.wav");
  return {
    path,
    build: async () => {
      // A distinct speech-band signal representing a separately recorded
      // interviewer question. It is deliberately different from the interview
      // warble so prompt routing is audible in the fixture film.
      await ffmpeg(
        [
          "-f", "lavfi",
          "-i",
          `aevalsrc='0.26*sin(2*PI*t*(310+90*sin(2*PI*t*0.9)))` +
            `*(0.62+0.38*sin(2*PI*t*2.4))':s=48000:d=${PROMPT_SECONDS}`,
          "-c:a", "pcm_s16le", "-ac", "2", "-ar", "48000",
          "-t", String(PROMPT_SECONDS),
        ],
        path,
      );
    },
  };
};

/* ── entry point ─────────────────────────────────────────────────────── */

export const generateFixtures = async (
  { force = FORCE, quiet = false }: { force?: boolean; quiet?: boolean } = {},
): Promise<void> => {
  const font = await findFont();
  const silentSpeech = await exists(referenceMusicSource());
  const speechMode = silentSpeech ? "silent" : "warble";
  const speechModeMarker = join(FIXTURES_DIR, "interview", ".speech-mode");
  const previousMode = (await exists(speechModeMarker))
    ? (await readFile(speechModeMarker, "utf8")).trim()
    : null;
  // No marker + warble: assume existing interview files are already warble.
  // No marker + silent: regenerate — those files almost certainly still warble.
  const speechModeChanged =
    previousMode === null ? silentSpeech : previousMode !== speechMode;

  const interviewJobs = INTERVIEWS.map((s) => interviewJob(s, font, silentSpeech));
  const otherJobs: Job[] = [
    ...BROLL.map((s) => brollJob(s, font)),
    ...STILLS.map((s) => stillJob(s, font)),
    promptAudioJob(),
    musicJob(),
  ];

  const log = (message: string): void => {
    if (!quiet) process.stdout.write(`${message}\n`);
  };

  if (speechModeChanged && previousMode !== null) {
    log(
      `fixtures: speech mode ${previousMode} → ${speechMode}; regenerating interview audio`,
    );
  }

  const pending: Job[] = [];
  for (const job of interviewJobs) {
    if (!force && !speechModeChanged && (await exists(job.path))) continue;
    pending.push(job);
  }
  for (const job of otherJobs) {
    if (!force && (await exists(job.path))) continue;
    pending.push(job);
  }

  const jobs = [...interviewJobs, ...otherJobs];

  if (pending.length === 0) {
    await mkdir(dirname(speechModeMarker), { recursive: true });
    await writeFile(speechModeMarker, `${speechMode}\n`, "utf8");
    log(`fixtures: all ${jobs.length} assets present (--force to regenerate)`);
    return;
  }

  log(`fixtures: generating ${pending.length} of ${jobs.length} assets into fixtures/`);
  const started = Date.now();

  // Bounded concurrency: FFmpeg saturates cores on its own, and 10 parallel
  // x264 encodes on a laptop is slower than 4.
  const CONCURRENCY = 4;
  let cursor = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      const job = pending[index];
      if (job === undefined) return;
      await job.build();
      done += 1;
      log(`  [${done}/${pending.length}] ${job.path.replace(ROOT, "")}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await mkdir(dirname(speechModeMarker), { recursive: true });
  await writeFile(speechModeMarker, `${speechMode}\n`, "utf8");

  log(`fixtures: done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
};

const isEntryPoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isEntryPoint) {
  generateFixtures().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
