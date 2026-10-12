/**
 * How long a tap takes, measured the way a person feels it.
 *
 *   pnpm --filter @film/web build && pnpm --filter @film/web start   # in another terminal
 *   pnpm perf                                                          # → a table
 *
 * Run it against a PRODUCTION build. `next dev` compiles on demand and does
 * not prefetch at all, so against `pnpm web` the numbers are about the dev
 * server, not the product. PERF_BASE_URL points it elsewhere (default
 * http://localhost:3200).
 *
 * For each tap, two numbers:
 *   - feedback: from the tap until the screen visibly changes — the next
 *     screen or its skeleton, whichever comes first. The "is it doing
 *     anything?" moment, which should be under 100 ms.
 *   - ready: until the next screen's own heading is showing.
 *
 * It walks a phone-sized, signed-out browser through the wizard the way a
 * person does, so like `pnpm screens` it leaves one anonymous film in the
 * database per run. The same walk timed `main` and Phase 8's branch for the
 * PR, so the two tables are comparable.
 */
import { chromium, type Page } from "playwright-core";

const BASE = process.env["PERF_BASE_URL"] ?? "http://localhost:3200";
const RUNS = Number(process.env["PERF_RUNS"] ?? "3");

type Row = { readonly tap: string; feedback: number[]; ready: number[] };

/**
 * The watcher, as source text rather than a function.
 *
 * tsx compiles named inner functions with a `__name(...)` helper for stack
 * traces, and that helper does not exist inside the page — so a function
 * passed to `page.evaluate` fails with "__name is not defined". A string is
 * evaluated as written.
 */
const WATCH = `(() => {
  const heading = () => document.querySelector("main h1, .wz-body h1")?.textContent ?? "";
  const perf = { before: heading(), t0: 0 };
  window.__perf = perf;
  const watch = () => {
    const now = performance.now();
    const changed = heading() !== perf.before;
    const busy = document.querySelector("[aria-busy='true']") !== null;
    if (perf.t0 > 0) {
      if ((changed || busy) && perf.feedback === undefined) perf.feedback = now - perf.t0;
      if (changed && !busy) { perf.ready = now - perf.t0; return; }
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
  // Stamped on the pointer, so the clock starts when the finger lands.
  addEventListener("pointerdown", () => { perf.t0 = performance.now(); }, { once: true, capture: true });
})()`;

/**
 * Tap, then watch the page from inside it, every animation frame.
 *
 * "Changed" is the main heading's text changing or a loading region
 * appearing; "ready" is the heading changing. Measured in the page with
 * `performance.now()` so the tool's own round trips are not in the number.
 */
const timeTap = async (page: Page, tap: () => Promise<void>): Promise<{ feedback: number; ready: number }> => {
  await page.evaluate(WATCH);
  await tap();
  try {
    const result = await page.waitForFunction(
      "window.__perf.ready === undefined ? null : " +
        "{ feedback: window.__perf.feedback ?? window.__perf.ready, ready: window.__perf.ready }",
      undefined,
      { timeout: 60_000, polling: 50 },
    );
    return (await result.jsonValue()) as { feedback: number; ready: number };
  } catch (error) {
    /**
     * A tap that never arrives is the finding, not a flaky tool: this is how
     * the Continue that saved and stayed put was caught. Say where it stuck.
     */
    const state: unknown = await page.evaluate(
      "({ url: location.pathname, heading: document.querySelector('main h1, .wz-body h1')?.textContent })",
    );
    process.stderr.write(`stuck after the tap: ${JSON.stringify(state)}\n`);
    throw error;
  }
};

/** Let prefetches the page started on arrival finish, as they would while somebody reads. */
const settle = async (page: Page): Promise<void> => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
};

const walk = async (rows: Map<string, Row>): Promise<void> => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const record = (tap: string, t: { feedback: number; ready: number }): void => {
    const row = rows.get(tap) ?? { tap, feedback: [], ready: [] };
    row.feedback.push(t.feedback);
    row.ready.push(t.ready);
    rows.set(tap, row);
  };

  try {
    await page.goto(new URL("/make", BASE).toString());
    await settle(page);
    record("Start this film → chapter intro", await timeTap(page, () =>
      page.getByRole("button", { name: /start this film/i }).first().click()));
    await page.waitForURL(/\/chapter\//);
    await settle(page);

    record("Begin → first step", await timeTap(page, () => page.getByRole("link", { name: /begin/i }).click()));
    await settle(page);

    await page.locator("main input").first().fill("Rose");
    record("Continue (after typing) → next step", await timeTap(page, () =>
      page.getByRole("button", { name: /continue/i }).first().click()));
    await settle(page);

    for (let i = 1; i <= 3; i++) {
      record(`Skip for now → next step (${String(i)})`, await timeTap(page, () =>
        page.getByRole("link", { name: /skip for now/i }).first().click()));
      await settle(page);
    }

    record("Back → previous step", await timeTap(page, () => page.getByRole("link", { name: "Back" }).click()));
    await settle(page);

    await page.getByRole("button", { name: /all steps/i }).click();
    record("All steps → See the overview", await timeTap(page, () =>
      page.getByRole("link", { name: /see the overview/i }).click()));
    await settle(page);

    record("Overview → home (Your films)", await timeTap(page, () =>
      page.getByRole("link", { name: /home/i }).first().click()));
  } finally {
    await browser.close();
  }
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const main = async (): Promise<void> => {
  process.stdout.write(`${BASE}, ${String(RUNS)} runs, medians\n\n`);
  const rows = new Map<string, Row>();
  for (let run = 0; run < RUNS; run++) await walk(rows);

  const pad = (s: string, n: number): string => s.padEnd(n);
  process.stdout.write(`${pad("Tap", 40)}${pad("feedback", 12)}ready\n`);
  for (const row of rows.values()) {
    process.stdout.write(
      `${pad(row.tap, 40)}${pad(`${String(Math.round(median(row.feedback)))} ms`, 12)}` +
        `${String(Math.round(median(row.ready)))} ms\n`,
    );
  }
};

await main();
