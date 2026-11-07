import { expect, type Page, test } from "@playwright/test";

interface Debugged {
  f1Debug: { engine: { trackLength: () => number } };
  runningAt?: number;
}

interface Loaded {
  path: string;
  bytes: number;
  end: number;
}

const softwareGpu = process.platform === "linux";
const sentCompressed = /\.(js|css|wasm|html)$|^\/$/;
const contentBudget = 2_500_000;
const raceOnly = [
  /^\/intro\/trailer\.mp4$/,
  /^\/assets\/road-[\w-]+\.glb$/,
  /^\/assets\/crew-[\w-]+\.glb$/,
  /^\/assets\/car-[\w-]+\.glb$/,
  /^\/assets\/[a-z]+(-env)?-[\w-]+\.hdr$/,
  /^\/assets\/tyre-[\w-]+\.png$/,
  /^\/assets\/terrain_albedo-[\w-]+\.jpg$/,
  /^\/assets\/crowd-[\w-]+\.bin$/,
  /^\/assets\/hill-country-[\w-]+\.xml$/,
  /^\/assets\/cockpit-[\w-]+\.bin$/,
  /^\/assets\/lod-[\w-]+\.bin$/,
  /^\/loading\//,
];

async function noteRunning(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const watch = new MutationObserver(() => {
      if (document.body.dataset["driveStatus"] !== "running") return;
      (window as unknown as Debugged).runningAt = performance.now();
      watch.disconnect();
    });
    document.addEventListener("DOMContentLoaded", () => {
      watch.observe(document.body, { attributeFilter: ["data-drive-status"] });
    });
  });
}

function loadedBeforeRunning(page: Page): Promise<Loaded[]> {
  return page.evaluate(() => {
    const runningAt = (window as unknown as Debugged).runningAt ?? Infinity;
    const wire = JSON.parse(
      document.querySelector("[data-asset-wire]")?.textContent ?? "{}",
    ) as Record<string, number>;
    return performance
      .getEntriesByType("resource")
      .map((entry) => entry as PerformanceResourceTiming)
      .filter((entry) => entry.responseEnd <= runningAt)
      .map((entry) => {
        const path = new URL(entry.name).pathname;
        return {
          path,
          bytes: wire[path] ?? (entry.transferSize || entry.encodedBodySize),
          end: entry.responseEnd,
        };
      });
  });
}

async function running(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.body.dataset["driveStatus"] === "running",
    null,
    { timeout: 120_000 },
  );
}

test.describe("first visit", () => {
  if (!softwareGpu) {
    test("a new player is driving on the Training Ground after a small download, without the trailer or any of the race's big files", async ({
      page,
    }) => {
      await noteRunning(page);
      await page.goto("/?debug");
      await running(page);
      await expect(page.locator("[data-tutorial=root]")).toHaveAttribute(
        "data-step",
        "welcome",
      );
      expect(
        await page.evaluate(() =>
          (window as unknown as Debugged).f1Debug.engine.trackLength(),
        ),
      ).toBeCloseTo(3432, -1);
      await expect(page.getByTestId("intro")).toHaveCount(0);

      const files = await loadedBeforeRunning(page);
      const content = files.filter((file) => !sentCompressed.test(file.path));
      const bytes = content.reduce((sum, file) => sum + file.bytes, 0);
      expect(content.length).toBeGreaterThan(10);
      expect(bytes).toBeLessThan(contentBudget);
      for (const file of files)
        for (const pattern of raceOnly)
          expect(file.path, "a race file on the first screen").not.toMatch(
            pattern,
          );
    });

    test("while Driving School runs, the race's files are saved in the browser so the hub and the first race need no download", async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await page.goto("/");
      await running(page);
      const stored = () =>
        page.evaluate(async () =>
          (await (await caches.open("revracers-assets")).keys()).map(
            (request) => new URL(request.url).pathname,
          ),
        );
      await expect
        .poll(
          async () => {
            const paths = await stored();
            return [
              /\/road-[\w-]+\.glb$/,
              /\/car-[\w-]+\.glb$/,
              /\/circuit-[\w-]+\.hdr$/,
              /\/lod-[\w-]+\.glb$/,
            ].every((pattern) => paths.some((path) => pattern.test(path)));
          },
          { timeout: 240_000, intervals: [2000] },
        )
        .toBe(true);
      await expect(page.locator("[data-tutorial=root]")).toHaveAttribute(
        "data-step",
        /.+/,
      );
    });
  }
});
