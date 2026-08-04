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

const filesContaining = (needle: string): string[] =>
  sourceFiles(SRC)
    .filter((path) => readFileSync(path, "utf8").includes(needle))
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
