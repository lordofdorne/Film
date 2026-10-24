import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { deliverableFilm, filmFilename, subjectNameOf } from "@film/db";
import { LocalObjectStore, contentDisposition } from "@film/storage";
import { accessToProject, signedInToAccount } from "../../../../src/server/auth.js";
import { store } from "../../../../src/server/project.js";
import { webDb } from "../../../../src/server/db.js";

const db = webDb;

/**
 * The end of the line: the customer gets their film.
 *
 * Everything upstream of this — intake, ingest, compose, approval, render,
 * deliver — existed to produce one file, and until now that file sat in
 * private storage with nothing offering it to the person it was made for.
 *
 * WHICH file is not decided here. `deliverableFilm` answers that from rows,
 * including the join to `approvals` that keeps an unapproved render from ever
 * being downloadable. This route only moves bytes.
 *
 * The ownership check is HERE, not only on the page that links to it. A guard
 * that lives on the page protects the link, not the file — and this route is
 * where the film actually leaves the building. Both check.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  // Same 404 as a project with no film. A download endpoint should not be a way
  // to find out whose projects exist.
  // A made film is kept behind an account, not the anonymous session that
  // made it — the same rule as the film's page.
  const access = await accessToProject(id);
  if (!access.allowed || !(await signedInToAccount())) {
    return NextResponse.json({ error: "no film is ready for this project" }, { status: 404 });
  }

  // The name is a cheap read and the film is the one that matters: ask both
  // at once rather than one after the other.
  const [film, subjectName] = await Promise.all([deliverableFilm(db(), id), subjectNameOf(db(), id)]);
  if (film === null) {
    // One answer for "no such project", "not approved yet" and "still
    // rendering". The page says which; a bare URL learns nothing from a
    // download endpoint about whether a project exists.
    return NextResponse.json({ error: "no film is ready for this project" }, { status: 404 });
  }

  const filename = filmFilename({ subjectName, edlVersion: film.edlVersion });

  /**
   * `?view` plays it in the page instead of saving it: the same file, the same
   * checks, with no "attachment" telling the browser to download it. The
   * finished film's own <video> on the ready screen points here.
   */
  const view = new URL(request.url).searchParams.has("view");

  const objects = store();

  /**
   * In production the file never passes through this server.
   *
   * A redirect to a signed URL hands the transfer to R2, which is the whole
   * reason the bucket has signed reads at all: a hundred-megabyte download
   * through Node would hold a request open for minutes and put the app server
   * on the critical path of every delivery.
   *
   * The URL is a bearer credential and is not logged.
   */
  if (!(objects instanceof LocalObjectStore)) {
    const url = await objects.signedGetUrl(film.outputKey, {
      expiresInSeconds: 900,
      ...(view ? {} : { downloadAs: filename }),
    });
    return NextResponse.redirect(url, 302);
  }

  /* ── local disk: stream it ourselves ──────────────────────────────── */
  const head = await objects.head(film.outputKey);
  if (head === null) {
    // The row says the render succeeded and the object is not there. That is a
    // real fault worth naming, not a 404 pretending nothing was ever promised.
    return NextResponse.json(
      { error: "the rendered film is missing from storage" },
      { status: 500 },
    );
  }

  const path = objects.resolveForRead(film.outputKey);

  /**
   * Range requests are honoured because a download this size gets interrupted.
   *
   * Without `accept-ranges`, a browser or a download manager that loses the
   * connection at 90 MB starts again from zero.
   */
  const range = request.headers.get("range");
  const headers = {
    "content-type": "video/mp4",
    "content-disposition": view ? "inline" : contentDisposition(filename),
    "accept-ranges": "bytes",
    // Private storage behind a URL that is not itself a credential yet. Keep
    // it out of shared caches regardless.
    "cache-control": "private, no-store",
  };

  if (range === null) {
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: { ...headers, "content-length": String(head.byteSize) },
    });
  }

  // Clamped before the filesystem sees it: a range past the end of the file
  // makes createReadStream throw, and 416 is the honest answer anyway.
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = Number(match?.[1] ?? 0);
  const requestedEnd =
    match?.[2] !== undefined && match[2] !== "" ? Number(match[2]) : head.byteSize - 1;
  const end = Math.min(Number.isFinite(requestedEnd) ? requestedEnd : head.byteSize - 1, head.byteSize - 1);
  if (!Number.isFinite(start) || start >= head.byteSize || end < start) {
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${String(head.byteSize)}` },
    });
  }

  return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, {
    status: 206,
    headers: {
      ...headers,
      "content-length": String(end - start + 1),
      "content-range": `bytes ${String(start)}-${String(end)}/${String(head.byteSize)}`,
    },
  });
}
