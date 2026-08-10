import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LocalObjectStore,
  MAX_SIGNED_URL_TTL_SECONDS,
  clampTtl,
  contentDisposition,
  objectKey,
  projectPrefix,
} from "../src/index.js";

const PROJECT_A = "11111111-1111-1111-1111-111111111111";
const PROJECT_B = "22222222-2222-2222-2222-222222222222";
const ASSET = "33333333-3333-3333-3333-333333333333";

describe("object keys", () => {
  it("scopes every key by project", () => {
    const key = objectKey({ projectId: PROJECT_A, kind: "original", assetId: ASSET, name: "take.mp4" });
    expect(key).toBe(`projects/${PROJECT_A}/original/${ASSET}/take.mp4`);
    expect(key.startsWith(projectPrefix(PROJECT_A))).toBe(true);
  });

  /**
   * Content addressing is project-scoped on purpose. Two customers who upload
   * the same photograph must not share an object — that is a privacy failure
   * dressed up as a storage saving.
   */
  it("gives two projects different keys for identical content", () => {
    const a = objectKey({ projectId: PROJECT_A, kind: "original", assetId: ASSET, name: "same.jpg" });
    const b = objectKey({ projectId: PROJECT_B, kind: "original", assetId: ASSET, name: "same.jpg" });
    expect(a).not.toBe(b);
  });

  it("refuses path traversal in any segment", () => {
    expect(() => objectKey({ projectId: "../etc", kind: "original", name: "x" })).toThrow(/unsafe/);
    expect(() => objectKey({ projectId: PROJECT_A, kind: "original", name: "../../etc/passwd" })).toThrow(/unsafe/);
  });

  it("rejects an unknown object kind", () => {
    expect(() =>
      objectKey({ projectId: PROJECT_A, kind: "secrets" as never, name: "x" }),
    ).toThrow();
  });
});

describe("signed URL TTLs", () => {
  /** Signed URLs are bearer credentials. A long TTL is a standing leak. */
  it("caps a long-lived request", () => {
    expect(clampTtl(86_400)).toBe(MAX_SIGNED_URL_TTL_SECONDS);
  });

  it("defaults short when unspecified", () => {
    expect(clampTtl(undefined)).toBe(300);
  });

  it("leaves a short request alone", () => {
    expect(clampTtl(60)).toBe(60);
  });
});

describe("LocalObjectStore", () => {
  let root: string;
  let store: LocalObjectStore;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "film-store-"));
    store = new LocalObjectStore(root);
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips an object with its size and etag", async () => {
    const key = objectKey({ projectId: PROJECT_A, kind: "original", assetId: ASSET, name: "a.bin" });
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    const put = await store.put(key, body, { contentType: "application/octet-stream" });

    expect(put.byteSize).toBe(5);
    expect(put.etag).toMatch(/^[a-f0-9]{32}$/);
    expect(await store.get(key)).toEqual(body);
    expect((await store.head(key))?.byteSize).toBe(5);
  });

  it("returns null rather than throwing for a missing object", async () => {
    expect(await store.head("projects/nope/original/x")).toBeNull();
  });

  it("lists and deletes a whole project by prefix", async () => {
    // This is what a deletion request and a retention expiry both rely on.
    for (const name of ["one.bin", "two.bin", "three.bin"]) {
      await store.put(objectKey({ projectId: PROJECT_B, kind: "original", assetId: ASSET, name }), new Uint8Array([9]));
    }
    expect(await store.list(projectPrefix(PROJECT_B))).toHaveLength(3);

    const deleted = await store.deletePrefix(projectPrefix(PROJECT_B));
    expect(deleted).toBe(3);
    expect(await store.list(projectPrefix(PROJECT_B))).toHaveLength(0);
    // Deleting one project must not touch another.
    expect((await store.list(projectPrefix(PROJECT_A))).length).toBeGreaterThan(0);
  });

  it("refuses a key that escapes the store root", async () => {
    await expect(store.put("../../escape.txt", new Uint8Array([1]))).rejects.toThrow(/escapes/);
  });
});

describe("content disposition", () => {
  it("asks the browser to save rather than play the file", () => {
    expect(contentDisposition("Life Advice (v1).mp4")).toMatch(/^attachment; /);
  });

  /**
   * The name reaches the header from a jsonb column that a customer typed
   * into. A quote would close the quoted string early and everything after it
   * would be read as further header directives.
   */
  it("cannot be escaped out of by a crafted name", () => {
    const header = contentDisposition('a"; filename="evil.exe');
    expect(header).toBe(
      'attachment; filename="a; filename=evil.exe"; ' +
        "filename*=UTF-8''a%3B%20filename%3Devil.exe",
    );
    // One quoted region, so nothing after the name is a directive.
    expect(header.match(/"/g)).toHaveLength(2);
  });

  it("strips a newline rather than letting it split the response", () => {
    const header = contentDisposition("film\r\nX-Injected: yes.mp4");
    expect(header).not.toMatch(/[\r\n]/);
  });

  /**
   * Two forms on purpose: the ASCII fallback keeps old clients working, and
   * filename* is what carries a name as it is actually spelled.
   */
  it("carries an accented name intact in the encoded form", () => {
    const header = contentDisposition("José Ramírez — Life Advice.mp4");
    expect(header).toContain("filename*=UTF-8''Jos%C3%A9%20Ram%C3%ADrez");
    // And degrades to something a browser without RFC 5987 can still save.
    expect(header).toContain('filename="Jos Ramrez  Life Advice.mp4"');
  });

  it("falls back to a usable name when nothing ASCII survives", () => {
    expect(contentDisposition("日本語.mp4")).toContain('filename="film.mp4"');
  });
});
