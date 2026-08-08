import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

/**
 * Comments are stripped before searching.
 *
 * This guard is about which modules *render* video and audio, not about which
 * ones mention them in prose. Grepping raw source made any doc comment
 * containing "<Video>" fail the build, which teaches people to reword comments
 * rather than to think about the boundary — and a guard everyone routes around
 * stops guarding anything.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const filesContaining = (needle: string): string[] =>
  sourceFiles(SRC)
    .filter((path) => stripComments(readFileSync(path, "utf8")).includes(needle))
    .map((path) => basename(path))
    .sort();

describe("audio and video routing boundaries", () => {
  it("renders dialogue and music through exactly three explicit audio tracks", () => {
    expect(filesContaining("import { Audio")).toEqual([
      "MusicBed.tsx",
      "PromptTrack.tsx",
      "SpeechTrack.tsx",
    ]);
  });

  it("renders video only through PictureOnlyVideo", () => {
    expect(filesContaining("<Video")).toEqual(["PictureOnlyVideo.tsx"]);
    expect(filesContaining("<OffthreadVideo")).toEqual(["PictureOnlyVideo.tsx"]);
  });
});
