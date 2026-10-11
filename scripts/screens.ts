/**
 * Every screen, at a phone's width and a laptop's, as PNGs for review.
 *
 *   pnpm web            # in another terminal
 *   pnpm screens        # → out/screens/{phone,desktop}-<screen>.png
 *
 * Drives the Chrome already installed on this machine (playwright-core, no
 * browser download), signed out, against whatever `pnpm web` is serving. It
 * presses Start once per viewport, so each run leaves two anonymous films in
 * capture in the dev database — the price of drawing the wizard for real
 * rather than a mock-up of it.
 *
 * Not a test: nothing is compared. It is the review surface for a visual
 * change — open the folder and look — and the thing to diff by eye before and
 * after one. Screens that need a finished film (preview, ready) are not here:
 * they need the worker and a real cut, and are walked by hand.
 */
import { mkdir } from "node:fs/promises";

import { chromium, type Page } from "playwright-core";

const BASE = process.env["SCREENS_BASE_URL"] ?? "http://localhost:3200";
const OUT = new URL("../out/screens/", import.meta.url);

const VIEWPORTS = {
  phone: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
} as const;

const shoot = async (page: Page, name: string): Promise<void> => {
  // Let fonts and the entrance animations settle.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const file = new URL(name, OUT);
  await page.screenshot({ path: file.pathname, fullPage: true });
  process.stdout.write(`  ${name}\n`);
};

const main = async (): Promise<void> => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });

  try {
    for (const [label, options] of Object.entries(VIEWPORTS)) {
      process.stdout.write(`${label}\n`);
      const context = await browser.newContext(options);
      const page = await context.newPage();
      const go = async (path: string, name: string): Promise<void> => {
        await page.goto(new URL(path, BASE).toString());
        await shoot(page, `${label}-${name}.png`);
      };

      await go("/", "home");
      await go("/make", "choose");
      await go("/signin", "signin");
      await go("/design", "design");
      await go("/no-such-page", "not-found");

      // Into the wizard the way a person gets there: press Start.
      await page.goto(new URL("/make", BASE).toString());
      await page.getByRole("button", { name: /start this film/i }).first().click();
      await page.waitForURL(/\/chapter\//, { timeout: 30_000 });
      await shoot(page, `${label}-wizard-intro.png`);
      const film = new URL(page.url()).pathname.split("/")[2] ?? "";

      await go(`/projects/${film}/step/subjectName`, "wizard-typed-step");
      await go(`/projects/${film}/step/photo_early`, "wizard-photo-step");
      await go(`/projects/${film}/step/greatest_lesson`, "wizard-question-step");
      await page.getByRole("button", { name: /all steps/i }).click();
      await page.waitForTimeout(400);
      await shoot(page, `${label}-wizard-all-steps.png`);
      await go(`/projects/${film}`, "overview");

      await context.close();
    }
  } finally {
    await browser.close();
  }
  process.stdout.write(`\nWritten to ${OUT.pathname}\n`);
};

await main();
