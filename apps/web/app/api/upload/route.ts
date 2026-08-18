import { NextResponse } from "next/server";

import { store } from "../../../src/server/project.js";
import { verifyLocalUpload } from "../../../src/server/capture.js";

/**
 * Development-only upload route — the mirror of /api/media.
 *
 * In production a signed PUT goes straight to R2 and media never touches this
 * server. Locally there is no R2, and the local store's signedPutUrl returns a
 * file:// URL the browser cannot PUT to, so the app has to accept the bytes
 * itself for the offline path to stay first-class.
 *
 * The URL is signed even here. An endpoint that writes whatever key it is
 * handed is a hole in development too, and the HMAC costs one comparison: it
 * covers the key and an expiry, so a URL minted for one asset cannot be edited
 * into a write anywhere else in the bucket.
 */
/**
 * More than any take: a 20-minute 1080p answer is around a gigabyte. The body
 * is buffered in memory below, so without a ceiling one oversized PUT — by
 * accident or on purpose — is the process's memory.
 */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

export async function PUT(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig");

  if (key === null || sig === null || !verifyLocalUpload(key, exp, sig)) {
    return NextResponse.json({ error: "not a valid upload URL" }, { status: 403 });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "that file is too large" }, { status: 413 });
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    return NextResponse.json({ error: "empty upload" }, { status: 400 });
  }
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "that file is too large" }, { status: 413 });
  }

  const contentType = request.headers.get("content-type");
  const stored = await store().put(key, new Uint8Array(body), {
    ...(contentType === null ? {} : { contentType }),
    contentLength: body.byteLength,
  });

  return NextResponse.json({ key: stored.key, byteSize: stored.byteSize });
}
