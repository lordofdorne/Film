/**
 * Turns the real recordings in incoming/ into a renderable project.
 *
 *   pnpm project:build
 *
 * This is a first, deliberately small slice of two later phases, run offline:
 * enough of Phase 2 (ingest) to make real media consistent and measurable, and
 * enough of Phase 5 (compose) to lay the template's beats out from what was
 * actually recorded rather than from hand-written timings.
 *
 * What it does NOT do: transcribe. Caption text comes from incoming/project.json
 * and word timings are estimated across measured speech runs. Real word-level
 * timing arrives with Phase 4.
 */
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AssetManifestSchema,
  validateEdl,
  type AssetEntry,
  type MusicTrackInfo,
} from "@film/edl";
import { getFormat } from "@film/formats";
import { PLACEHOLDER_TRACK, resolveTrack } from "@film/music";
import { getTemplate, toConformance, type SubjectData } from "@film/templates";

import { composeFilm, type IngestedAnswer, type StillAsset } from "./lib/compose.js";
import { detectSpeechRuns, ffmpeg, probe } from "./lib/media.js";
import { buildLoopedBed, describeTempTrack, type TempBedConfig } from "./lib/musicBed.js";
import { generateFixtures, FIXTURES_DIR } from "./generate-fixtures.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INCOMING = join(ROOT, "incoming");
const PROJECT = join(ROOT, "project", "real");
const MEDIA = join(PROJECT, "media");

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

/** incoming/project.json — the editable description of this test project. */
type ProjectConfig = {
  projectId: string;
  subject: SubjectData;
  answers: Record<
    string,
    {
      spoken: string;
      coldOpen?: string;
      emphasis?: { phrase: string; tone: "funny" | "meaningful" | "surprising" };
    }
  >;
  questionPrompts?: string[];
  music?: TempBedConfig;
};

/** incoming filename -> question id. */
const INTERVIEW_FILES: ReadonlyArray<readonly [string, string]> = [
  ["q01_identity_name", "identity_name"],
  ["q02_identity_age", "identity_age"],
  ["q03_identity_birth_year", "identity_birth_year"],
  ["q04_longevity", "longevity"],
  ["q05_greatest_lesson", "greatest_lesson"],
  ["q06_advice_for_young_people", "advice_for_young_people"],
  ["q07_meaning_of_group", "meaning_of_group"],
  ["q08_love_lesson", "love_lesson"],
  ["q09_closing_message", "closing_message"],
  ["q10_bonus_interviewer", "bonus_interviewer"],
];

const PHOTO_SLOTS: ReadonlyArray<readonly [string, string]> = [
  ["photo_early", "photo_early"],
  ["photo_personality", "photo_personality"],
  ["photo_group", "photo_group"],
  ["keepsake", "keepsake"],
];

/** B-roll was not supplied, so the synthetic clips stand in for now. */
const BROLL_SLOTS: ReadonlyArray<readonly [string, string]> = [
  ["video_environment", "asset_broll_environment"],
  ["video_group", "asset_broll_group"],
  ["video_personality", "asset_broll_personality"],
];

const main = async (): Promise<void> => {
  const started = Date.now();
  const config = JSON.parse(
    await readFile(join(INCOMING, "project.json"), "utf8"),
  ) as ProjectConfig;

  const template = getTemplate("life-advice", 1);
  const format = getFormat(template.defaultFormatId);

  await mkdir(join(MEDIA, "interview"), { recursive: true });
  await mkdir(join(MEDIA, "photo"), { recursive: true });
  await mkdir(join(MEDIA, "broll"), { recursive: true });
  await mkdir(join(MEDIA, "music"), { recursive: true });

  /* ── 1. ingest the answers ───────────────────────────────────────── */
  log("\n[1m1/4  Ingesting answers[0m");
  const assets: AssetEntry[] = [];
  const answers: IngestedAnswer[] = [];

  for (const [file, questionId] of INTERVIEW_FILES) {
    const source = join(INCOMING, "interview", `${file}.mov`);
    const assetId = `asset_iv_${questionId}`;
    const out = join(MEDIA, "interview", `${assetId}.mp4`);

    const info = await probe(source);

    /**
     * Normalise on the way in: constant frame rate, faststart, rotation baked
     * into the pixels, and per-clip loudness normalisation to -16 LUFS.
     *
     * That last one closes a real gap. SpeechTrack applies no gain because the
     * brief says clips are loudness-normalised at ingest — until now nothing
     * did it, and the fixtures only happened to be uniform. Answers recorded
     * at different distances from the mic would otherwise jump in level
     * between beats.
     */
    await ffmpeg([
      "-i", source,
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-r", String(format.fps),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart",
      out,
    ]);

    const normalised = await probe(out);

    /**
     * Speech is measured on the ORIGINAL take, not the normalised one.
     *
     * Loudness normalisation lifts everything — including room tone — so a
     * gate that correctly reads a quiet room as silence before normalisation
     * reads it as speech afterwards. Measured here: every clip came back
     * "speaking" from frame zero to the last frame, which erased the quiet
     * ends the subject was asked to leave and left nothing to hold a question
     * card on. Normalisation does not change timing, so the boundaries found
     * on the source are valid for the output.
     */
    const runs = (await detectSpeechRuns(source)).map((r) => ({
      startMs: Math.min(r.startMs, normalised.durationMs),
      endMs: Math.min(r.endMs, normalised.durationMs),
    }));
    const spoken = config.answers[questionId];
    if (spoken === undefined) {
      throw new Error(`incoming/project.json has no spoken text for "${questionId}"`);
    }

    assets.push({
      id: assetId,
      kind: "interview",
      questionId,
      durationMs: normalised.durationMs,
      width: normalised.width,
      height: normalised.height,
    });
    answers.push({
      questionId,
      assetId,
      durationMs: normalised.durationMs,
      runs,
      spoken: spoken.spoken,
      ...(spoken.coldOpen !== undefined ? { coldOpen: spoken.coldOpen } : {}),
      ...(spoken.emphasis !== undefined ? { emphasis: spoken.emphasis } : {}),
    });

    const speaking = runs.reduce((n, r) => n + (r.endMs - r.startMs), 0);
    log(
      `  ${questionId.padEnd(24)} ${info.width}x${info.height} ` +
        `${(normalised.durationMs / 1000).toFixed(1)}s take, ` +
        `${(speaking / 1000).toFixed(1)}s speech in ${String(runs.length)} run(s)`,
    );
  }

  /* ── 2. stills ───────────────────────────────────────────────────── */
  log("\n[1m2/4  Ingesting stills[0m");
  const stills: StillAsset[] = [];
  for (const [file, slotId] of PHOTO_SLOTS) {
    const source = join(INCOMING, "photo", `${file}.jpg`);
    const assetId = `asset_${slotId}`;
    const out = join(MEDIA, "photo", `${assetId}.jpg`);

    // EXIF orientation applied physically and the tag stripped, so downstream
    // never has to remember to honour it.
    await ffmpeg(["-i", source, "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-q:v", "2", out]);
    const info = await probe(out);

    assets.push({ id: assetId, kind: "photo", slotId, width: info.width, height: info.height });
    stills.push({ assetId, slotId });

    // QC warning, not a blocker: an undersized still is upscaled, never
    // refused. The customer decides whether it is good enough.
    const warn = info.width < format.width ? "  [33m(below output width)[0m" : "";
    log(`  ${slotId.padEnd(24)} ${info.width}x${info.height}${warn}`);
  }

  /* ── 3. placeholder b-roll and music ─────────────────────────────── */
  log("\n[1m3/4  Placeholder b-roll and music[0m");
  await generateFixtures({ quiet: true });
  const brollAssetIds: Record<string, string> = {};
  for (const [slotId, fixtureId] of BROLL_SLOTS) {
    const assetId = `asset_broll_${slotId.replace("video_", "")}`;
    const out = join(MEDIA, "broll", `${assetId}.mp4`);
    await cp(join(FIXTURES_DIR, "broll", `${fixtureId}.mp4`), out);
    const info = await probe(out);
    assets.push({
      id: assetId,
      kind: "video",
      slotId,
      durationMs: info.durationMs,
      width: info.width,
      height: info.height,
    });
    brollAssetIds[slotId] = assetId;
  }
  let track: MusicTrackInfo = {
    id: PLACEHOLDER_TRACK.id,
    durationMs: PLACEHOLDER_TRACK.durationMs,
    beatGridMs: PLACEHOLDER_TRACK.beatGridMs,
    cues: PLACEHOLDER_TRACK.cues,
    licenseRef: PLACEHOLDER_TRACK.licenseRef,
    usage: PLACEHOLDER_TRACK.usage,
    available: PLACEHOLDER_TRACK.available,
  };

  if (config.music === undefined) {
    await cp(
      join(FIXTURES_DIR, "music", `${PLACEHOLDER_TRACK.id}.wav`),
      join(MEDIA, "music", `${PLACEHOLDER_TRACK.id}.wav`),
    );
    log("  3 placeholder b-roll clips, placeholder tone bed");
  } else {
    const bed = config.music;
    const built = await buildLoopedBed(
      bed,
      join(INCOMING, bed.sourceFile),
      join(MEDIA, "music", `${bed.trackId}.wav`),
      join(MEDIA, "music", `.${bed.trackId}-segment.wav`),
    );
    track = describeTempTrack(bed, built.durationMs);
    log(
      `  3 placeholder b-roll clips, temp bed "${bed.title}": ` +
        `${(built.segmentMs / 1000).toFixed(1)}s crop x${String(built.repeats)} ` +
        `crossfaded to ${(built.durationMs / 1000).toFixed(1)}s`,
    );
  }

  /* ── 4. compose and validate ─────────────────────────────────────── */
  log("\n[1m4/4  Composing[0m");
  const manifest = AssetManifestSchema.parse({ assets });

  const { edl, notes } = composeFilm({
    projectId: config.projectId,
    template,
    answers,
    stills,
    brollAssetIds,
    assetDurationMs: Object.fromEntries(
      assets.flatMap((a) => (a.durationMs === undefined ? [] : [[a.id, a.durationMs] as const])),
    ),
    track,
    promptQuestionIds: config.questionPrompts ?? [],
  });

  for (const note of notes) log(`  [33mnote:[0m ${note}`);

  const result = validateEdl(edl, {
    manifest,
    format,
    conformance: toConformance(template),
    resolveMusicTrack: (id: string) => (id === track.id ? track : resolveTrack(id)),
    allowPlaceholderMusic: true,
  });

  // Warnings never block — they are QC notes the customer gets to weigh — but
  // they must be visible, or "it validated" quietly comes to mean nothing.
  for (const w of result.warnings) log(`  \x1b[33mwarn:\x1b[0m ${w.code} at ${w.path} — ${w.message}`);
  if (!result.ok) {
    const lines = result.errors.map((e) => `  ${e.code} at ${e.path}: ${e.message}`);
    throw new Error(`composed EDL failed validation:\n${lines.join("\n")}`);
  }
  const validated = result.edl;

  await writeFile(join(PROJECT, "edl.json"), `${JSON.stringify(validated, null, 2)}\n`);
  await writeFile(join(PROJECT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    join(PROJECT, "subject.json"),
    `${JSON.stringify(config.subject, null, 2)}\n`,
  );
  // The renderer needs to resolve this track too, and it does not belong in
  // the shipped registry.
  await writeFile(join(PROJECT, "music-track.json"), `${JSON.stringify(track, null, 2)}\n`);

  const mins = Math.floor(validated.totalDurationMs / 60000);
  const secs = Math.round((validated.totalDurationMs % 60000) / 1000);
  log(
    `\n[1mComposed ${String(validated.visualSegments.length)} visual, ` +
      `${String(validated.speechSegments.length)} speech, ` +
      `${String(validated.promptSegments.length)} prompt segments — ` +
      `${mins}:${String(secs).padStart(2, "0")}[0m`,
  );
  log(`Wrote project/real/ in ${((Date.now() - started) / 1000).toFixed(1)}s`);
};

main().catch((error: unknown) => {
  process.stderr.write(
    `\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
