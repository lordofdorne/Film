import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

const mod = (name: string, file: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/${file}.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    /* Tests run against source, not dist, so `pnpm test` needs no build step.
       Vite resolves the "./foo.js" specifiers back to "./foo.ts" itself. */
    /* Subpath entries come first: Vite matches string aliases by prefix, so a
       bare "@film/render" would swallow "@film/render/props". */
    alias: {
      "@film/render/props": mod("render", "projectProps"),
      "@film/render/composition": mod("render", "composition"),
      "@film/render/project": mod("render", "fixture"),
      "@film/pipeline/model": mod("pipeline", "model"),
      "@film/edl": pkg("edl"),
      "@film/formats": pkg("formats"),
      "@film/music": pkg("music"),
      "@film/templates": pkg("templates"),
      "@film/db": pkg("db"),
      "@film/queue": pkg("queue"),
      "@film/storage": pkg("storage"),
      "@film/render": pkg("render"),
      "@film/pipeline": pkg("pipeline"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx"],
    environment: "node",
    /* Golden-frame tests spawn Chrome and are slow by nature. */
    testTimeout: 120_000,
    hookTimeout: 120_000,
    /**
     * One test file at a time, because several of them share one development
     * Postgres.
     *
     * Scoped project ids are not enough on their own: with files running in
     * parallel the suite failed twice — once in `dispatch.test.ts`, once as a
     * 120-SECOND timeout in `runStage.test.ts` — and both passed immediately
     * when run alone. A suite that is sometimes red for no reason is a suite
     * people stop reading.
     *
     * It costs about 13 seconds (31s against 18s). That was judged too much
     * for a single unreproduced failure and obviously worth it for a second
     * one that wasted two minutes on a timeout.
     */
    fileParallelism: false,
  },
});
