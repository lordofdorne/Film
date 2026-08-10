import type { NextConfig } from "next";

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
