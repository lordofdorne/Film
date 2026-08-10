import { z } from "zod";

/**
 * Content addressing is PROJECT-SCOPED.
 *
 * A raw global hash must never be a public identifier, and derived outputs are
 * never deduplicated across projects. Two customers who happen to upload the
 * same photograph must not end up sharing an object — that is a privacy
 * failure, not a storage optimisation. Hash-based reuse exists so a retry
 * within one project is idempotent, and for nothing else.
 */
export const ObjectKindSchema = z.enum([
  "original",
  "normalised",
  "transcript",
  "selection",
  "render",
  "still",
]);
export type ObjectKind = z.infer<typeof ObjectKindSchema>;

const SAFE_SEGMENT = /^[A-Za-z0-9_\-.]+$/;

const assertSafe = (label: string, value: string): void => {
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(`unsafe ${label} for a storage key: "${value}"`);
  }
};

/**
 * projects/<projectId>/<kind>/<assetId>/<name>
 *
 * The project id leads so a deletion request is a prefix delete, and so no key
 * is meaningful without knowing which project it belongs to.
 */
export const objectKey = (input: {
  readonly projectId: string;
  readonly kind: ObjectKind;
  readonly assetId?: string;
  readonly name: string;
}): string => {
  assertSafe("projectId", input.projectId);
  assertSafe("name", input.name);
  if (input.assetId !== undefined) assertSafe("assetId", input.assetId);

  return [
    "projects",
    input.projectId,
    ObjectKindSchema.parse(input.kind),
    ...(input.assetId === undefined ? [] : [input.assetId]),
    input.name,
  ].join("/");
};

/** Everything under one project, for retention expiry and deletion requests. */
export const projectPrefix = (projectId: string): string => {
  assertSafe("projectId", projectId);
  return `projects/${projectId}/`;
};

export type SignedUrlOptions = {
  /**
   * Signed URLs are bearer credentials. Short by default, scoped to a single
   * key and method, never logged and never embedded in an email.
   */
  readonly expiresInSeconds?: number;
  /**
   * Save the object under this name instead of its key.
   *
   * A storage key is addressed for the system's convenience. Handing one
   * straight to a browser puts `delivery-landscape-classic-v1.mp4` in
   * someone's Downloads folder, which is a bad name for a film they intend to
   * keep. Only meaningful on a store that can serve the object directly.
   */
  readonly downloadAs?: string;
};

export const MAX_SIGNED_URL_TTL_SECONDS = 900;

/**
 * A Content-Disposition header that survives a real name.
 *
 * Two forms, per RFC 6266: a quoted ASCII fallback for anything old, and
 * `filename*` in RFC 5987 percent-encoded UTF-8 for everything current. A
 * browser that understands the second ignores the first, which is how "José"
 * arrives intact rather than as "Jos".
 *
 * The ASCII fallback is built by dropping bytes rather than transliterating.
 * A name that reduces to nothing still has `filename*` carrying the truth, and
 * a wrong guess at someone's name is worse than a plain one.
 */
export const contentDisposition = (filename: string): string => {
  const stripped = filename.replace(/[\u0000-\u001f\u007f"\\]/g, "");
  const ascii = stripped.replace(/[^\u0020-\u007e]/g, "").trim();
  // The stem, not the whole string: a name written entirely in a non-Latin
  // script reduces to ".mp4", which is not empty but is a hidden file with no
  // name. If nothing is left before the extension, use the fallback.
  const dot = ascii.lastIndexOf(".");
  const stem = dot === -1 ? ascii : ascii.slice(0, dot);
  const fallback = stem.trim() === "" ? "film.mp4" : ascii;
  const encoded = encodeURIComponent(stripped);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

export type PutOptions = {
  readonly contentType?: string;
  readonly contentLength?: number;
};

export type StoredObject = {
  readonly key: string;
  readonly byteSize: number;
  readonly etag: string | null;
  readonly contentType: string | null;
};

/**
 * The storage boundary.
 *
 * Local disk in tests and offline development, R2 in production. Keeping the
 * offline path a first-class implementation rather than a mock is what lets
 * the whole fixture pipeline keep running with no network — which has been the
 * project's fastest feedback loop and is worth protecting.
 */
export interface ObjectStore {
  put(key: string, body: Uint8Array | NodeJS.ReadableStream, options?: PutOptions): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
  list(prefix: string): Promise<string[]>;
  /** Read-only URL for the renderer or the browser. */
  signedGetUrl(key: string, options?: SignedUrlOptions): Promise<string>;
  /** Write-only URL so media never proxies through the app server. */
  signedPutUrl(key: string, options?: SignedUrlOptions & PutOptions): Promise<string>;
}

export const clampTtl = (requested: number | undefined): number =>
  Math.min(requested ?? 300, MAX_SIGNED_URL_TTL_SECONDS);


import { LocalObjectStore } from "./local.js";
import { R2ObjectStore } from "./r2.js";

export * from "./local.js";
export * from "./r2.js";

/**
 * The store this process should use, from the environment.
 *
 * One function rather than one per caller. The worker writes objects and the
 * web app reads them, and if they disagree about the root the failure is a
 * blank preview with no error anywhere — which is a genuinely hard afternoon.
 *
 * R2 when it is configured, local disk otherwise. The local implementation is
 * real rather than a mock, which is what keeps the whole pipeline runnable
 * with no cloud account attached.
 */
export const storeFromEnv = (): ObjectStore => {
  const accountId = process.env["R2_ACCOUNT_ID"];
  if (accountId === undefined || accountId === "") {
    return new LocalObjectStore(process.env["STORAGE_ROOT"] ?? ".storage");
  }
  return new R2ObjectStore({
    accountId,
    bucket: process.env["R2_BUCKET"] ?? "",
    accessKeyId: process.env["R2_ACCESS_KEY_ID"] ?? "",
    secretAccessKey: process.env["R2_SECRET_ACCESS_KEY"] ?? "",
  });
};

/** True when objects live on local disk, so they must be streamed, not signed. */
export const usingLocalStore = (): boolean => {
  const id = process.env["R2_ACCOUNT_ID"];
  return id === undefined || id === "";
};
