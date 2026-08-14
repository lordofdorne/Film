import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

/**
 * One .env for the whole repository, at the root.
 *
 * Next only looks for env files beside the app it is running, so this app used
 * to keep its own copy of DATABASE_URL_WEB and STORAGE_ROOT — and the copies
 * had to agree. When they disagreed the symptom was a blank preview with no
 * error anywhere, which the checkpoint lists as one of three things that fail
 * quietly. Two files that must match is not a configuration style, it is a bug
 * with a waiting period.
 *
 * loadEnvFile does not overwrite variables already in the environment, so a
 * deployment's real configuration still wins over anything left in a file.
 */
const ROOT_ENV = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

const config: NextConfig = {
  // Workspace packages ship compiled ESM; Next needs to know they are ours.
  transpilePackages: [
    "@film/render",
    "@film/edl",
    "@film/templates",
    "@film/formats",
    "@film/music",
    "@film/db",
    "@film/storage",
    "@film/pipeline",
  ],
  // pg and drizzle must stay on the Node side, never bundled for the browser.
  serverExternalPackages: ["pg", "drizzle-orm"],
  webpack: (cfg) => {
    /**
     * The repo writes explicit ".js" extensions on relative imports because
     * that is the one spelling Node, tsx and Vitest all resolve identically.
     * Next's webpack is the fifth runtime here and, like Remotion's, needs
     * telling — see scripts/webpack-override.ts for the same fix.
     */
    cfg.resolve.extensionAlias = {
      ...cfg.resolve.extensionAlias,
      ".js": [".tsx", ".ts", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    // @film/render imports its pinned .woff2 so the font is identical in the
    // browser and in the render container.
    cfg.module.rules.push({ test: /\.woff2$/, type: "asset/resource" });
    return cfg;
  },
};

export default config;
