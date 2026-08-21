import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  ObjectStore,
  PutOptions,
  SignedUrlOptions,
  StoredObject,
} from "./index.js";
import { clampTtl } from "./index.js";

/**
 * Filesystem-backed store for tests and offline development.
 *
 * A real implementation rather than a mock, deliberately: the offline fixture
 * pipeline is the project's fastest feedback loop, and it stays fast only if
 * the storage boundary behaves the same way with no network.
 */
export class LocalObjectStore implements ObjectStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  /** Refuses to escape the root, so a crafted key cannot write anywhere else. */
  #resolve(key: string): string {
    const full = resolve(this.#root, key);
    const rel = relative(this.#root, full);
    if (rel.startsWith("..") || rel.startsWith(sep) || rel === "") {
      throw new Error(`key escapes the store root: "${key}"`);
    }
    return full;
  }

  /**
   * The on-disk path for a key, for callers that must stream bytes themselves.
   *
   * Exposed only on the local implementation: R2 has no filesystem path, and
   * anything depending on this would not survive the switch to production
   * storage. Used by the development media route, which exists so the preview
   * works with no cloud account attached.
   */
  resolveForRead(key: string): string {
    return this.#resolve(key);
  }

  async put(
    key: string,
    body: Uint8Array | NodeJS.ReadableStream,
    options: PutOptions = {},
  ): Promise<StoredObject> {
    const path = this.#resolve(key);
    await mkdir(dirname(path), { recursive: true });

    const digest = createHash("md5");

    if (body instanceof Uint8Array) {
      digest.update(body);
      await writeFile(path, body);
      return {
        key,
        byteSize: body.byteLength,
        // Same shape as an S3 ETag so callers cannot come to depend on the
        // difference between the two implementations.
        etag: digest.digest("hex"),
        contentType: options.contentType ?? null,
      };
    }

    /**
     * Straight to disk, hashing on the way past.
     *
     * This used to read the whole stream into memory first, which for a
     * finished film is 120 MB held for no reason — and it made local
     * development the one place a streaming caller was silently not streaming.
     * The two implementations should be wrong in the same ways or in none.
     */
    let byteSize = 0;
    await pipeline(
      Readable.from(body),
      async function* (source: AsyncIterable<Buffer | string>) {
        for await (const chunk of source) {
          const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          byteSize += buffer.byteLength;
          digest.update(buffer);
          yield buffer;
        }
      },
      createWriteStream(path),
    );

    return {
      key,
      byteSize,
      etag: digest.digest("hex"),
      contentType: options.contentType ?? null,
    };
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.#resolve(key)));
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const info = await stat(this.#resolve(key));
      return { key, byteSize: info.size, etag: null, contentType: null };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.#resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<number> {
    const keys = await this.list(prefix);
    await Promise.all(keys.map(async (k) => rm(this.#resolve(k), { force: true })));
    return keys.length;
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.#resolve(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else out.push(relative(this.#root, full).split(sep).join("/"));
      }
    };
    await walk(base);
    return out.sort();
  }

  /**
   * file:// URLs; the TTL is meaningless locally but the signature matches.
   *
   * `downloadAs` is ignored rather than faked: nothing serves a file:// URL,
   * so there is no response to attach a header to. Callers that need a named
   * download from local disk stream the bytes themselves and set the header on
   * their own response — which is what the web app's download route does.
   */
  async signedGetUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    void clampTtl(options.expiresInSeconds);
    return `file://${this.#resolve(key)}`;
  }

  async signedPutUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    void clampTtl(options.expiresInSeconds);
    return `file://${this.#resolve(key)}`;
  }
}
