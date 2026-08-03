import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    /* Tests run against source, not dist, so `pnpm test` needs no build step.
       Vite resolves the "./foo.js" specifiers back to "./foo.ts" itself. */
    alias: {
      "@film/edl": pkg("edl"),
      "@film/formats": pkg("formats"),
      "@film/music": pkg("music"),
      "@film/templates": pkg("templates"),
      "@film/render": pkg("render"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx"],
    environment: "node",
    /* Golden-frame tests spawn Chrome and are slow by nature. */
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
