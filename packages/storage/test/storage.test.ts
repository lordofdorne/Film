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
  stableWindow,
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

/**
 * The rounding that lets a browser cache a signed URL.
 *
 * A signature carries the moment it was made, so the hub handed out seventeen
 * brand-new URLs on every render — and it re-renders on every window focus.
 * Nothing it showed was ever a cache hit. Rounding the signing clock down to a
 * window makes renders inside that window produce identical URLs.
 */
describe("stableWindow", () => {
  const at = (iso: string): number => new Date(iso).getTime();

  it("is undefined when nobody asked, which is the default", () => {
    expect(stableWindow(undefined, 900)).toBeUndefined();
    expect(stableWindow(0, 900)).toBeUndefined();
  });

  it("gives two moments in the same window the same answer", () => {
    const a = stableWindow(300, 900, at("2026-08-25T12:01:00Z"));
    const b = stableWindow(300, 900, at("2026-08-25T12:04:59Z"));
    expect(a?.toISOString()).toBe(b?.toISOString());
    expect(a?.toISOString()).toBe("2026-08-25T12:00:00.000Z");
  });

  it("moves on at the boundary", () => {
    const before = stableWindow(300, 900, at("2026-08-25T12:04:59Z"));
    const after = stableWindow(300, 900, at("2026-08-25T12:05:00Z"));
    expect(before?.toISOString()).not.toBe(after?.toISOString());
  });

  /**
   * Never forward. A signature dated in the future is rejected outright, and
   * every machine's clock is a little wrong — rounding up would turn a
   * harmless skew into thumbnails that intermittently do not load.
   */
  it("only ever rounds into the past", () => {
    const now = at("2026-08-25T12:04:59Z");
    const rounded = stableWindow(300, 900, now);
    expect(rounded?.getTime()).toBeLessThanOrEqual(now);
  });

  /**
   * The bug this cap exists to prevent: rounding down spends life the URL had,
   * so a window as long as the TTL could hand a browser a URL that expired
   * before it arrived. Capped at half, the worst case still has half its life.
   */
  it("never lets the window eat more than half the URL's life", () => {
    const now = at("2026-08-25T12:09:59Z");
    const rounded = stableWindow(900, 900, now);
    const spent = (now - (rounded?.getTime() ?? now)) / 1000;
    expect(spent).toBeLessThanOrEqual(450);
  });

  it("refuses a window on a TTL too short to afford one", () => {
    expect(stableWindow(300, 1)).toBeUndefined();
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
