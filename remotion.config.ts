/**
 * Config for the Remotion CLI (`pnpm studio`) only.
 *
 * The render pipeline does NOT read this file — scripts/render-fixture-film.ts
 * passes the same options to bundle() programmatically. Both import the one
 * webpackOverride so the Studio and the delivered film cannot drift apart in
 * how modules or fonts resolve.
 */
import { Config } from "@remotion/cli/config";
import { resolve } from "node:path";

import { webpackOverride } from "./scripts/webpack-override.js";

// staticFile() resolves against the generated fixture media.
// The CLI compiles this file as CommonJS, so import.meta is unavailable here —
// hence cwd rather than the module URL used everywhere else in the repo.
Config.setPublicDir(resolve(process.cwd(), "fixtures"));
Config.overrideWebpackConfig(webpackOverride);

// Match the delivery render so what you scrub is what you get. The one thing
// Studio cannot reproduce is final loudness mastering, which happens in FFmpeg
// after Remotion has finished — preview is not acoustically identical.
Config.setVideoImageFormat("jpeg");
Config.setConcurrency(1);
