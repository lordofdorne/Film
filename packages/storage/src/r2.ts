import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  ObjectStore,
  PutOptions,
  SignedUrlOptions,
  StoredObject,
} from "./index.js";
import { clampTtl, contentDisposition, stableWindow } from "./index.js";

export type R2Config = {
  readonly accountId: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
};

/**
 * Cloudflare R2 over the S3 API.
 *
 * The bucket stays private. Nothing here ever returns a public URL — every
 * read and write goes through a short-lived signed URL scoped to one key and
 * one method, so a leaked URL is a small, expiring problem rather than a
 * standing one. CORS is configured for exactly the production and local
 * origins, and media never proxies through the app server.
 */
export class R2ObjectStore implements ObjectStore {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(config: R2Config) {
    this.#bucket = config.bucket;
    this.#client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  /**
   * Multipart, always.
   *
   * A finished film is around 120 MB and the things being stored are whole
   * video files, so the two ways to get this wrong are both real: buffer the
   * file and a worker holds 120 MB per concurrent render; hand the SDK a bare
   * stream and it cannot retry, because a stream that has been read once
   * cannot be read again — a blip at 90 MB would throw away a render that took
   * minutes of CPU.
   *
   * `Upload` avoids both. It reads the stream in parts, holds only the parts
   * in flight, and retries a failed part rather than the file. For anything
   * smaller than one part it does a plain PUT, so the small objects — an
   * EDL, a still, the music bed — cost nothing extra.
   *
   * The dangling cost of multipart is an aborted upload leaving parts nobody
   * can see and everybody pays for, which is what the bucket's
   * abort-incomplete-multipart lifecycle rule is for. It is not optional.
   */
  async put(
    key: string,
    body: Uint8Array | NodeJS.ReadableStream,
    options: PutOptions = {},
  ): Promise<StoredObject> {
    const upload = new Upload({
      client: this.#client,
      params: {
        Bucket: this.#bucket,
        Key: key,
        Body: body as never,
        ...(options.contentType === undefined ? {} : { ContentType: options.contentType }),
        ...(options.cacheControl === undefined ? {} : { CacheControl: options.cacheControl }),
      },
      // 8 MB × 4 in flight: about 32 MB of headroom per upload, against a
      // worker that also has ffmpeg and a browser on it.
      partSize: 8 * 1024 * 1024,
      queueSize: 4,
      leavePartsOnError: false,
    });

    const result = (await upload.done()) as { ETag?: string };
    const head = await this.head(key);
    return {
      key,
      byteSize: head?.byteSize ?? options.contentLength ?? 0,
      etag: result.ETag?.replaceAll('"', "") ?? null,
      contentType: options.contentType ?? null,
    };
  }

  async get(key: string): Promise<Uint8Array> {
    const result = await this.#client.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (bytes === undefined) throw new Error(`no body for "${key}"`);
    return bytes;
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      return {
        key,
        byteSize: result.ContentLength ?? 0,
        etag: result.ETag?.replaceAll('"', "") ?? null,
        contentType: result.ContentType ?? null,
      };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.#client.send(
      new DeleteObjectsCommand({
        Bucket: this.#bucket,
        Delete: { Objects: [{ Key: key }] },
      }),
    );
  }

  async deletePrefix(prefix: string): Promise<number> {
    const keys = await this.list(prefix);
    // S3 caps DeleteObjects at 1000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      if (batch.length === 0) continue;
      await this.#client.send(
        new DeleteObjectsCommand({
          Bucket: this.#bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }),
      );
    }
    return keys.length;
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: prefix,
          ...(token === undefined ? {} : { ContinuationToken: token }),
        }),
      );
      for (const item of page.Contents ?? []) {
        if (item.Key !== undefined) keys.push(item.Key);
      }
      token = page.NextContinuationToken;
    } while (token !== undefined);
    return keys;
  }

  /**
   * A short-lived read URL, optionally one that downloads under a real name.
   *
   * `downloadAs` is signed into the request as ResponseContentDisposition, so
   * R2 returns the header and the browser saves the file as the customer's
   * film rather than as a storage key. Signing it in matters: the parameter is
   * covered by the signature, so nobody can rewrite the URL to make the object
   * come back as something else.
   *
   * The fifteen-minute cap looks wrong for a hundred-megabyte download and is
   * not: S3-style expiry is checked when the request is made, not while the
   * bytes are moving. A download that starts inside the window finishes.
   */
  async signedGetUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    const expiresIn = clampTtl(options.expiresInSeconds);
    /**
     * Signing the current five-minute mark rather than the current instant, so
     * a hub rendered twice hands the browser the same URL twice and the second
     * one costs nothing. The credential stays exactly as short-lived; only the
     * clock it is measured from is rounded.
     */
    const signingDate = stableWindow(options.stableForSeconds, expiresIn);
    return getSignedUrl(
      this.#client,
      new GetObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        ...(options.downloadAs === undefined
          ? {}
          : { ResponseContentDisposition: contentDisposition(options.downloadAs) }),
      }),
      { expiresIn, ...(signingDate === undefined ? {} : { signingDate }) },
    );
  }

  async signedPutUrl(
    key: string,
    options: SignedUrlOptions & PutOptions = {},
  ): Promise<string> {
    return getSignedUrl(
      this.#client,
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        /**
         * ContentType and nothing else, `cacheControl` included.
         *
         * Anything named here is covered by the signature, so the browser has
         * to send it back verbatim or R2 answers 403 — a failure local
         * development cannot reproduce, because the local upload route does not
         * check. ContentType earns that; a caching hint on somebody's raw
         * upload does not.
         */
        ...(options.contentType === undefined ? {} : { ContentType: options.contentType }),
      }),
      { expiresIn: clampTtl(options.expiresInSeconds) },
    );
  }
}
