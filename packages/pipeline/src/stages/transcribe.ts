import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { assets, hashInputs, type StageIdentity } from "@film/db";
import { objectKey } from "@film/storage";

import { extractSpeechAudio, transcribeAudio, type Transcript } from "../media/whisper.js";
import { permanent } from "../runtime/errors.js";
import type { StageContext } from "../runtime/runStage.js";
import { AssetSelectionSchema, type AssetRow } from "../model.js";

/**
 * The recipe's version, in the input hash.
 *
 * Bump it when the transcript this stage produces would differ for the same
 * audio — a different prompt, a different post-processing rule. The model name
 * is hashed separately, so swapping models already re-transcribes on its own.
 */
export const TRANSCRIBE_RECIPE = 1;

/** Whisper wants a few hundred megabytes of scratch for a long answer. */
const SCRATCH_HEADROOM_BYTES = 2 * 1024 * 1024 * 1024;

export const transcribeRequiresFreeBytes = (): number => SCRATCH_HEADROOM_BYTES;

export const transcribeIdentity = (row: AssetRow): StageIdentity => ({
  projectId: row.projectId,
  assetId: row.id,
  stage: "transcribe",
  inputHash: hashInputs({
    normalisedKey: row.normalisedKey ?? "",
    model: process.env["WHISPER_MODEL"] ?? "",
    language: process.env["WHISPER_LANGUAGE"] ?? "en",
    recipe: TRANSCRIBE_RECIPE,
  }),
});

/** An answer already has usable words: typed at intake, or corrected by hand. */
export const hasSelection = (row: AssetRow): boolean =>
  AssetSelectionSchema.safeParse(row.selection).success;

/**
 * Turn one recorded answer into the words that were said.
 *
 * This is the step that stood between everything else and a film anybody could
 * receive. Compose permanently rejects an interview take with no
 * `selection.spoken`, and until now nothing produced those words: a film made
 * in the browser ingested cleanly, reached compose and died there.
 *
 * It runs PER TAKE, as soon as that take has been ingested — while the
 * customer is still sitting there recording the next answer. By the time they
 * press "Make my film" the words are already in the database, so the wait at
 * the end is the render and nothing else. It is the same reasoning that put
 * ingest inside capture: the work that can be done early should be.
 *
 * A selection that already exists is never overwritten. Intake types the words
 * in by hand, and one day somebody will correct a transcript in a browser;
 * both of those are better sources than this stage, and both would be silently
 * undone by a re-run if this did not check.
 */
export const runTranscribe = async (ctx: StageContext): Promise<string | null> => {
  if (ctx.assetId === null) throw permanent("transcribe was dispatched without an asset");

  const rows = await ctx.db.select().from(assets).where(eq(assets.id, ctx.assetId)).limit(1);
  const row = rows[0];
  if (row === undefined) throw permanent(`asset ${ctx.assetId} no longer exists`);

  if (row.kind !== "interview") {
    // Nothing else in a film has words in it. Not an error — the dispatcher
    // should not have asked, and saying so is cheaper than wondering later.
    throw permanent(`asset ${row.id} is a ${row.kind}, which has nothing to transcribe`);
  }

  if (hasSelection(row as AssetRow)) {
    await ctx.log.info("already has words from a better source than this — left alone");
    return null;
  }

  const normalisedKey = row.normalisedKey;
  if (normalisedKey === null) {
    // Transient: ingest is what produces it, and the dispatcher only asks for
    // this after ingest has succeeded, so a race resolves itself.
    throw new Error("this take has not been ingested yet");
  }

  const dir = await ctx.scratch();
  const media = join(dir, "take.mp4");
  const wav = join(dir, "speech.wav");

  const bytes = await ctx.store.get(normalisedKey);
  await writeFile(media, bytes);
  await extractSpeechAudio(media, wav, { signal: ctx.signal });

  const transcript = await transcribeAudio(wav, { signal: ctx.signal });

  /**
   * Silence is a permanent failure, and a useful one.
   *
   * A take with no words in it cannot be cut into a film, and no number of
   * retries will find any. Failing here puts a note on that answer's hub card
   * while the customer is still in the room and can record it again — which is
   * the entire point of doing this during capture. A capturing project is
   * never marked failed for it.
   */
  if (transcript.text === "") {
    throw permanent("no words could be heard in this take — it may need recording again");
  }

  const key = objectKey({
    projectId: ctx.projectId,
    kind: "transcript",
    assetId: row.id,
    name: "transcript.json",
  });

  const document: Transcript & { readonly assetId: string; readonly transcribedAt: string } = {
    ...transcript,
    assetId: row.id,
    transcribedAt: new Date().toISOString(),
  };

  /**
   * The transcript object is written before the row points at it, the same
   * ordering every other stage uses. An object nobody references can be swept;
   * a row pointing at nothing is a film that fails somewhere else entirely.
   */
  await ctx.store.put(key, new TextEncoder().encode(JSON.stringify(document, null, 2)), {
    contentType: "application/json",
  });

  await ctx.db
    .update(assets)
    .set({ transcriptKey: key, selection: { spoken: transcript.text } })
    .where(eq(assets.id, row.id));

  const words = transcript.text.split(/\s+/).length;
  await ctx.log.info(
    `${String(words)} words from ${transcript.model} (${(bytes.byteLength / 1e6).toFixed(1)} MB of video)`,
  );

  return hashInputs({ text: transcript.text });
};
