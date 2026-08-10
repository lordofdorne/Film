/**
 * Creates a project from the recordings in incoming/, and stops.
 *
 *   pnpm intake
 *
 * This is the whole of intake: files go to the object store, rows go to
 * Postgres, the project lands in `processing`. Nothing is ingested, composed
 * or rendered here — the worker's dispatcher picks it up on its next tick.
 *
 * It replaces seed-real-project.ts, which wrote the same rows a slightly
 * different way. Two paths writing the shape the web app reads is how the
 * preview breaks without anybody touching it.
 */
import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDb } from "@film/db";
import { createProject, type IntakeAsset } from "@film/pipeline";
import { MUSIC_BED_SLOT, type ProjectConfig } from "@film/pipeline/model";
import { storeFromEnv } from "@film/storage";
import type { SubjectData } from "@film/templates";

import { FIXTURES_DIR, generateFixtures } from "./generate-fixtures.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INCOMING = join(ROOT, "incoming");

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

/** incoming/project.json — the editable description of this test project. */
type ProjectFile = {
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
  music?: {
    trackId: string;
    title: string;
    sourceFile: string;
    cropStartMs: number;
    cropEndMs: number;
    crossfadeMs: number;
    targetDurationMs: number;
  };
};

/**
 * incoming/interview/qNN_<question_id>.mov -> question id.
 *
 * The number orders the takes for a human reading the directory; the pipeline
 * binds on the question id, which is what the template knows about.
 */
const questionIdOf = (file: string): string =>
  basename(file, extname(file)).replace(/^q\d+_/, "");

/** Slots the template reserves for b-roll, and the fixture that stands in. */
const PLACEHOLDER_BROLL: ReadonlyArray<readonly [string, string]> = [
  ["video_environment", "asset_broll_environment"],
  ["video_group", "asset_broll_group"],
  ["video_personality", "asset_broll_personality"],
];

const main = async (): Promise<void> => {
  const { db, pool } = createDb("web");
  const store = storeFromEnv();

  try {
    const config = JSON.parse(
      await readFile(join(INCOMING, "project.json"), "utf8"),
    ) as ProjectFile;

    const list = async (dir: string, ext: RegExp): Promise<string[]> =>
      (await readdir(join(INCOMING, dir)).catch(() => []))
        .filter((f) => ext.test(f))
        .sort()
        .map((f) => join(INCOMING, dir, f));

    const intake: IntakeAsset[] = [];

    for (const path of await list("interview", /\.(mov|mp4|m4v)$/i)) {
      const questionId = questionIdOf(path);
      const answer = config.answers[questionId];
      if (answer === undefined) {
        throw new Error(
          `incoming/project.json has no spoken text for "${questionId}" ` +
            `(from ${basename(path)})`,
        );
      }
      intake.push({
        kind: "interview",
        questionId,
        path,
        contentType: "video/quicktime",
        selection: {
          spoken: answer.spoken,
          ...(answer.coldOpen === undefined ? {} : { coldOpen: answer.coldOpen }),
          ...(answer.emphasis === undefined ? {} : { emphasis: answer.emphasis }),
        },
      });
    }

    for (const path of await list("photo", /\.(jpe?g|png|heic)$/i)) {
      intake.push({
        kind: "photo",
        slotId: basename(path, extname(path)),
        path,
        contentType: "image/jpeg",
      });
    }

    const broll = await list("broll", /\.(mov|mp4|m4v)$/i);
    if (broll.length > 0) {
      for (const path of broll) {
        intake.push({
          kind: "video",
          slotId: basename(path, extname(path)),
          path,
          contentType: "video/mp4",
        });
      }
    } else {
      /**
       * No b-roll supplied, so the synthetic clips stand in.
       *
       * The template's beats reserve slots for it and compose refuses to
       * invent a shot it was not given — correctly, since guessing what
       * belongs on screen is exactly what a template engine must not do. This
       * is a decision by the development intake script, not by the pipeline:
       * real intake will ask the customer for these or drop the beats.
       */
      await generateFixtures({ quiet: true });
      for (const [slotId, fixture] of PLACEHOLDER_BROLL) {
        intake.push({
          kind: "video",
          slotId,
          path: join(FIXTURES_DIR, "broll", `${fixture}.mp4`),
          contentType: "video/mp4",
        });
      }
      log(`  no b-roll in incoming/broll — using ${String(PLACEHOLDER_BROLL.length)} placeholders`);
    }

    if (config.music === undefined) {
      throw new Error("incoming/project.json has no music config, so there is no bed to build");
    }
    intake.push({
      kind: "audio",
      slotId: MUSIC_BED_SLOT,
      path: join(INCOMING, config.music.sourceFile),
      contentType: "audio/mpeg",
    });

    const projectConfig: ProjectConfig = {
      questionPrompts: config.questionPrompts ?? [],
      music: {
        trackId: config.music.trackId,
        title: config.music.title,
        cropStartMs: config.music.cropStartMs,
        cropEndMs: config.music.cropEndMs,
        crossfadeMs: config.music.crossfadeMs,
        targetDurationMs: config.music.targetDurationMs,
      },
    };

    const result = await createProject(
      { db, store },
      {
        ownerEmail: process.env["INTAKE_OWNER_EMAIL"] ?? "owner@example.com",
        templateId: "life-advice",
        templateVersion: 1,
        subject: config.subject,
        config: projectConfig,
        assets: intake,
      },
    );

    const byKind = intake.reduce<Record<string, number>>((counts, a) => {
      counts[a.kind] = (counts[a.kind] ?? 0) + 1;
      return counts;
    }, {});

    log(`\ncreated project ${result.projectId}`);
    log(
      `  ${String(intake.length)} assets uploaded — ` +
        Object.entries(byKind)
          .map(([kind, n]) => `${String(n)} ${kind}`)
          .join(", "),
    );
    log(`  status: processing — start the worker and it will take it from here`);
    log(`\n  pnpm worker`);
    log(`  open http://localhost:3200/projects/${result.projectId}\n`);
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(
    `\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
