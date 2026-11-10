import { randomBytes } from "node:crypto";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { playerKeyName } from "../support/player.ts";

interface Debugged {
  f1Debug: { engine: { trackLength: () => number } };
  runningAt?: number;
}

interface Built {
  parallel: boolean;
  label: string;
}

interface Noted {
  builtBeforeRunning: Built[];
}

interface Stepped {
  steps: Record<string, number>;
}

interface Loaded {
  path: string;
  bytes: number;
  end: number;
}

const softwareGpu = process.platform === "linux";
const sentCompressed = /\.(js|css|wasm|html)$|^\/$/;
const contentBudget = 2_500_000;
const mipmapMaker = /^mipmap-/;
const gameScript = /\/assets\/drive-[\w-]+\.js$/;
const welcomeRead = 3;
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

async function notePipelines(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const built: Built[] = [];
    (window as unknown as Noted).builtBeforeRunning = built;
    for (const [method, parallel] of [
      ["createRenderPipeline", false],
      ["createRenderPipelineAsync", true],
    ] as const) {
      const original = Object.getOwnPropertyDescriptor(
        GPUDevice.prototype,
        method,
      )?.value as (descriptor: GPURenderPipelineDescriptor) => unknown;
      Object.defineProperty(GPUDevice.prototype, method, {
        value(this: GPUDevice, descriptor: GPURenderPipelineDescriptor) {
          if (document.body.dataset["driveStatus"] !== "running")
            built.push({ parallel, label: descriptor.label ?? "" });
          return original.call(this, descriptor);
        },
      });
    }
  });
}

async function holdGameScript(page: Page, ms: number): Promise<void> {
  await page.route(gameScript, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

async function noteSteps(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const steps: Record<string, number> = {};
    (window as unknown as Stepped).steps = steps;
    new MutationObserver(() => {
      const step = document.querySelector<HTMLElement>("[data-tutorial=root]")
        ?.dataset["step"];
      if (step && !(step in steps)) steps[step] = performance.now() / 1000;
    }).observe(document, { subtree: true, attributes: true });
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

async function leftSchoolEarly(context: BrowserContext): Promise<void> {
  const key = randomBytes(32).toString("base64url");
  const joined = await context.request.post("/api/players", {
    data: { key },
  });
  expect(joined.ok()).toBe(true);
  const { driver } = (await joined.json()) as { driver: unknown };
  await context.addInitScript(
    ([name, value, cached]) => {
      localStorage.setItem(name, value);
      localStorage.setItem("revracers.driver", cached);
    },
    [playerKeyName, key, JSON.stringify(driver)] as const,
  );
}

const newcomers = [
  { who: "a new player", arrive: () => Promise.resolve() },
  {
    who: "a new player who left Driving School part-way and comes back",
    arrive: leftSchoolEarly,
  },
];

async function running(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.body.dataset["driveStatus"] === "running",
    null,
    { timeout: 120_000 },
  );
}

test.describe("first visit", () => {
  if (!softwareGpu) {
    for (const { who, arrive } of newcomers)
      test(`${who} is driving on the Training Ground after a small download, without the trailer, the loading screen or any of the race's big files`, async ({
        page,
        context,
      }) => {
        await arrive(context);
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

    test("a new player's first frame builds its shaders side by side instead of one after another", async ({
      page,
    }) => {
      await notePipelines(page);
      await page.goto("/");
      await running(page);
      const built = await page.evaluate(
        () => (window as unknown as Noted).builtBeforeRunning,
      );
      const start = built.findIndex((pipeline) => pipeline.parallel);
      expect(start, "no shader was built in parallel").toBeGreaterThanOrEqual(
        0,
      );
      expect(
        built
          .slice(start)
          .filter(
            (pipeline) =>
              !pipeline.parallel && !mipmapMaker.test(pipeline.label),
          ),
      ).toEqual([]);
    });

    test("a new player sees Driving School's first card before the game script arrives, and it hands over to the live lesson without adding to the card's reading time", async ({
      page,
    }) => {
      await holdGameScript(page, 3000);
      await noteSteps(page);
      await page.goto("/");
      const still = page.locator("[data-school-still]");
      await expect(still.getByText("Driving School")).toBeVisible({
        timeout: 1500,
      });
      await expect(still.getByText(/Press Esc to skip/)).toBeVisible();
      await running(page);
      await expect(page.locator("[data-tutorial=root]")).toHaveAttribute(
        "data-step",
        "welcome",
      );
      await expect(still).toHaveCount(0, { timeout: 3000 });
      await expect(page.locator("[data-tutorial=root]")).toHaveAttribute(
        "data-step",
        "controls",
        { timeout: 10_000 },
      );
      const { welcome = 0, controls = 0 } = await page.evaluate(
        () => (window as unknown as Stepped).steps,
      );
      expect(controls - welcome).toBeGreaterThan(1.2);
      expect(controls - welcome).toBeLessThan(welcomeRead - 0.5);
    });

    test("pressing Esc on Driving School's first card skips it as soon as the game is ready", async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await holdGameScript(page, 2000);
      await page.goto("/");
      const still = page.locator("[data-school-still]");
      await expect(still.getByText("Driving School")).toBeVisible({
        timeout: 1500,
      });
      await page.keyboard.press("Escape");
      await expect(still.getByText(/Skipping/)).toBeVisible();
      await expect(page.locator("[data-front=name]")).toBeVisible({
        timeout: 120_000,
      });
      await expect(page.locator("[data-tutorial=root]")).toBeHidden();
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
