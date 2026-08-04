import type { WebpackOverrideFn } from "@remotion/bundler";

type WebpackConfig = Parameters<WebpackOverrideFn>[0];
type Rules = NonNullable<NonNullable<WebpackConfig["module"]>["rules"]>;
type Rule = Rules[number];

/**
 * Inline font files as data URIs instead of emitting them as separate assets.
 *
 * Remotion's default rule makes .woff2 an `asset/resource`, so the font
 * becomes an HTTP request against the bundle server. During a long render
 * Remotion recycles its page, every recycle re-runs the font gate, and one of
 * those refetches eventually hangs — which surfaces as a delayRender timeout
 * a fifth of the way through the film rather than as a network error.
 *
 * A data URI has nothing to fetch and nothing to fail. It also makes the
 * bundle genuinely self-contained, which is what the offline requirement
 * actually asks for. The cost is about 150KB of base64 in the bundle.
 */
const inlineFontRules = (rules: Rules): Rules =>
  rules.map((rule: Rule): Rule => {
    if (
      rule !== null &&
      typeof rule === "object" &&
      "test" in rule &&
      rule.test instanceof RegExp &&
      rule.test.test("font.woff2")
    ) {
      return { ...rule, type: "asset/inline" as const };
    }
    return rule;
  });

/**
 * Teach Remotion's webpack that "./Root.js" means "./Root.tsx".
 *
 * The repo writes explicit ".js" extensions on relative imports because that
 * is the one spelling Node, tsx and Vitest all resolve identically. Webpack is
 * the fourth runtime and the only one that needs telling: without
 * extensionAlias it looks for a literal Root.js, then Root.js.tsx, and gives
 * up. Node's ESM resolver requires the extension, TypeScript maps it back to
 * the source file, and this makes webpack agree with both.
 */
export const webpackOverride: WebpackOverrideFn = (config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: {
      ...config.resolve?.extensionAlias,
      ".js": [".tsx", ".ts", ".js"],
      ".jsx": [".tsx", ".jsx"],
    },
  },
  module: {
    ...config.module,
    rules: inlineFontRules(config.module?.rules ?? []),
  },
});
