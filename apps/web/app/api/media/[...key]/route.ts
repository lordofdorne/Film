import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { LocalObjectStore } from "@film/storage";
import { accessToProject } from "../../../../src/server/auth.js";
import { store } from "../../../../src/server/project.js";

/**
 * Development-only media route.
 *
 * The local object store addresses files on disk, which a browser cannot load
 * over file://. This streams them instead, so the preview works with no cloud
 * account attached. In production R2 issues short-lived signed URLs and this
 * route is never reached — media must never proxy through the app server at
 * scale, and this exists solely so the offline path stays first-class.
 *
 * Range requests are honoured because <video> seeking depends on them; without
 * that the Player can only play from the start.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const objects = store();
  if (!(objects instanceof LocalObjectStore)) {
    return NextResponse.json({ error: "not available with remote storage" }, { status: 404 });
  }

  const { key } = await context.params;
  const storageKey = key.join("/");

  /**
   * Every key this route may serve is project-scoped, and the project id is the
   * second segment. That is not a coincidence to rely on quietly: `objectKey`
   * puts the project first precisely so a deletion is a prefix delete, and it
   * means the owner of any object is knowable from its key alone.
   *
   * Without this, the guards on the pages would protect the pages and not the
   * media — someone with a key could still fetch the recordings.
   */
  const [prefix, projectId] = key;
  if (prefix !== "projects" || projectId === undefined) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const access = await accessToProject(projectId);
  if (!access.allowed) return NextResponse.json({ error: "not found" }, { status: 404 });

  const head = await objects.head(storageKey);
  if (head === null) return NextResponse.json({ error: "not found" }, { status: 404 });

  const path = objects.resolveForRead(storageKey);
  const contentType = guessType(storageKey);
  const range = request.headers.get("range");

  if (range === null) {
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: {
        "content-type": contentType,
        "content-length": String(head.byteSize),
        "accept-ranges": "bytes",
      },
    });
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = Number(match?.[1] ?? 0);
  const end = match?.[2] !== undefined && match[2] !== "" ? Number(match[2]) : head.byteSize - 1;

  return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, {
    status: 206,
    headers: {
      "content-type": contentType,
      "content-length": String(end - start + 1),
      "content-range": `bytes ${String(start)}-${String(end)}/${String(head.byteSize)}`,
      "accept-ranges": "bytes",
    },
  });
}

const guessType = (key: string): string => {
  if (key.endsWith(".mp4")) return "video/mp4";
  if (key.endsWith(".mov")) return "video/quicktime";
  // What MediaRecorder produces in Chrome and Firefox. Capture plays the
  // original back so someone can check the take they just recorded, and a
  // browser will not play what it is told is an octet-stream.
  if (key.endsWith(".webm")) return "video/webm";
  if (key.endsWith(".wav")) return "audio/wav";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".heic")) return "image/heic";
  return "application/octet-stream";
};
