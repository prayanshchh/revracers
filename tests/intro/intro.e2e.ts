import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { pastSchool, playerKeyName, seedPlayer } from "../support/player.ts";
import { slowNetwork } from "../support/slow-network.ts";

function trailer(page: Page) {
  return page.evaluate(() => {
    const video =
      document.querySelector<HTMLVideoElement>("[data-intro] video");
    return {
      time: video?.currentTime ?? -1,
      muted: video?.muted ?? null,
      music: document.body.dataset["music"] ?? "",
      status: document.body.dataset["driveStatus"] ?? "",
    };
  });
}

async function playing(page: Page): Promise<void> {
  await expect(page.getByTestId("intro")).toBeVisible();
  await expect
    .poll(async () => (await trailer(page)).time, { timeout: 30_000 })
    .toBeGreaterThan(1);
}

async function seekToEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const video =
      document.querySelector<HTMLVideoElement>("[data-intro] video");
    if (video) video.currentTime = video.duration - 0.3;
  });
  await expect(page.getByTestId("intro")).toHaveCount(0, { timeout: 10_000 });
}

interface LoadScreen {
  showing: boolean;
  received: number;
  total: number;
  bar: number;
  slide: string;
  music: string;
}

declare global {
  interface Window {
    loadBytesLog: string[];
  }
}

function logLoadBytes(): void {
  const log: string[] = [];
  window.loadBytesLog = log;
  new MutationObserver(() => {
    const text =
      document.querySelector("[data-testid=load-bytes]")?.textContent ?? "";
    if (text && text !== log.at(-1)) log.push(text);
  }).observe(document, { subtree: true, childList: true, characterData: true });
}

async function loadScreen(page: Page): Promise<LoadScreen> {
  const screen = await page.evaluate(() => {
    const status = document.querySelector("[data-testid=drive-status]");
    const slides = Array.from(
      document.querySelectorAll<HTMLImageElement>(".show-slide.on"),
    ).filter((image) => image.naturalWidth > 0);
    return {
      showing:
        status !== null &&
        !status.hasAttribute("hidden") &&
        status.classList.contains("showing"),
      bytes:
        document.querySelector("[data-testid=load-bytes]")?.textContent ?? "",
      bar:
        document
          .querySelector("[data-testid=load-line]")
          ?.getAttribute("aria-valuenow") ?? null,
      slide: slides[0]?.getAttribute("src") ?? "",
      music: document.body.dataset["music"] ?? "",
    };
  });
  const bytes = /([\d.]+) MB \/ ([\d.]+) MB/.exec(screen.bytes) ?? [];
  return {
    showing: screen.showing,
    received: Number(bytes[1] ?? 0),
    total: Number(bytes[2] ?? 0),
    bar: Number(screen.bar ?? 0),
    slide: screen.slide,
    music: screen.music,
  };
}

function rising(values: number[]): boolean {
  return values.every(
    (value, index) => index === 0 || value >= (values[index - 1] ?? 0),
  );
}

async function countDuring(page: Page, seconds: number): Promise<LoadScreen[]> {
  const samples: LoadScreen[] = [];
  for (let tick = 0; tick < seconds * 2; tick += 1) {
    const sample = await loadScreen(page);
    if (!sample.showing && samples.length > 0) break;
    if (sample.showing && sample.total > 0) samples.push(sample);
    await page.waitForTimeout(500);
  }
  return samples;
}

test.describe("loading trailer", () => {
  test.setTimeout(240_000);

  if (process.platform !== "linux") {
    test("a new player goes straight into Driving School with no trailer, and the trailer does not come back after the lesson in the same visit", async ({
      page,
    }) => {
      const trailers: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/intro/trailer.mp4"))
          trailers.push(request.url());
      });
      await page.goto("/");
      await expect(page.getByTestId("intro")).toHaveCount(0);
      await expect
        .poll(async () => (await trailer(page)).status, { timeout: 60_000 })
        .toBe("running");
      await expect(page.locator("[data-tutorial=root]")).toHaveAttribute(
        "data-step",
        "welcome",
      );
      await page.waitForTimeout(800);
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-front=name]")).toBeVisible({
        timeout: 120_000,
      });
      await expect(page.getByTestId("intro")).toHaveCount(0);
      expect(trailers).toEqual([]);
    });

    test("a returning driver's hub and menu music wait for the trailer, keys never reach the hub, and it plays once", async ({
      page,
      context,
    }) => {
      await seedPlayer(context);
      await pastSchool(context);
      await page.goto("/");
      await playing(page);
      const hub = page.locator(".front-hub");
      await expect(hub).toBeAttached({ timeout: 60_000 });
      await expect(
        page.getByTestId("intro").getByRole("button", { name: "Skip" }),
      ).toBeVisible();

      await page.keyboard.press("Enter");
      expect(await trailer(page)).toMatchObject({ muted: false, music: "" });

      await seekToEnd(page);
      await expect(hub).toBeVisible();
      await expect(page.locator('[data-menu="root"]')).toBeHidden();
      await expect.poll(async () => (await trailer(page)).music).toBe("menu");

      await page.reload();
      await expect(hub).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("intro")).toHaveCount(0);
    });

    test("after the trailer, a slow race download shows game screenshots, megabytes of a steady total and a thin bar that keeps filling, with music", async ({
      page,
      context,
    }) => {
      test.setTimeout(420_000);
      await seedPlayer(context);
      await pastSchool(context);
      await page.addInitScript(logLoadBytes);
      await slowNetwork(page, 40);
      await page.goto("/");
      await playing(page);
      await expect(page.locator(".front-hub")).toBeAttached({
        timeout: 180_000,
      });
      await page.waitForTimeout(12_000);
      await seekToEnd(page);
      await page.getByRole("button", { name: /^Race/ }).click();
      await page.locator('[data-menu="start"]').click();
      await expect
        .poll(async () => (await loadScreen(page)).slide, { timeout: 30_000 })
        .toMatch(/^\/loading\/\d+\.jpg$/);

      const samples: LoadScreen[] = [];
      for (let second = 0; second < 240; second += 1) {
        const sample = await loadScreen(page);
        if (!sample.showing) break;
        if (sample.total > 0) samples.push(sample);
        await page.waitForTimeout(1000);
      }

      expect(samples.length).toBeGreaterThan(10);
      expect(
        new Set(samples.map((sample) => sample.slide)).size,
      ).toBeGreaterThan(1);
      expect(samples.every((sample) => sample.music === "menu")).toBe(true);
      expect(rising(samples.map((sample) => sample.received))).toBe(true);
      expect(rising(samples.map((sample) => sample.bar))).toBe(true);
      const totals = samples.map((sample) => sample.total);
      expect(Math.max(...totals)).toBeGreaterThan(50);
      expect(Math.max(...totals) / Math.min(...totals)).toBeLessThan(1.1);
      const counted = await page.evaluate(() => window.loadBytesLog.at(-1));
      const [, received, total, percent] =
        /([\d.]+) MB \/ ([\d.]+) MB · (\d+)%/.exec(counted ?? "") ?? [];
      expect(received).toBe(total);
      expect(percent).toBe("100");

      await expect
        .poll(async () => (await trailer(page)).status)
        .toBe("running");
    });

    test("a returning driver who skips the trailer sees a fresh download count when a race loads later", async ({
      page,
      context,
    }) => {
      test.setTimeout(420_000);
      await seedPlayer(context);
      await pastSchool(context);
      await slowNetwork(page, 40);
      await page.goto("/");
      await page
        .getByTestId("intro")
        .getByRole("button", { name: "Skip" })
        .click({ timeout: 60_000 });
      await expect(page.locator(".front-hub")).toBeVisible({
        timeout: 180_000,
      });
      await page.getByRole("button", { name: /^Race/ }).click();
      await page.locator('[data-menu="start"]').click();

      const samples = await countDuring(page, 300);
      expect(samples.length).toBeGreaterThan(5);
      expect(samples[0]?.received).toBeLessThan(8);
      expect(samples[0]?.bar).toBeLessThan(30);
      expect(samples.every((sample) => sample.received <= sample.total)).toBe(
        true,
      );
      expect(rising(samples.map((sample) => sample.bar))).toBe(true);
      expect(samples.at(-1)?.bar).toBe(100);
    });

    test("a driver who has not finished naming themselves hears no menu music under the trailer", async ({
      page,
      context,
    }) => {
      const key = randomBytes(32).toString("base64url");
      const joined = await context.request.post("/api/players", {
        data: { key },
      });
      expect(joined.ok()).toBe(true);
      await context.addInitScript(
        ([name, value]) => {
          localStorage.setItem(name, value);
          localStorage.setItem("revracers.tutorial", "skipped");
        },
        [playerKeyName, key] as const,
      );
      await page.goto("/");
      await playing(page);
      await expect(page.locator("[data-front=name]")).toBeAttached({
        timeout: 60_000,
      });
      await page.waitForTimeout(1000);
      expect((await trailer(page)).music).toBe("");

      await seekToEnd(page);
      await expect.poll(async () => (await trailer(page)).music).toBe("menu");
    });

    test("Skip and sound work before the game's main script has downloaded", async ({
      page,
      context,
    }) => {
      await pastSchool(context);
      let held = 0;
      await page.route("**/assets/*.js", async (route) => {
        const response = await route.fetch();
        const body = await response.body();
        if (body.length > 500_000) {
          held += 1;
          await new Promise((resolve) => setTimeout(resolve, 12_000));
        }
        await route.fulfill({ response, body });
      });
      await page.goto("/", { waitUntil: "commit" });
      const skip = page.getByTestId("intro").getByRole("button", {
        name: "Skip",
      });
      await expect(skip).toBeVisible({ timeout: 6_000 });
      await page.keyboard.press("Enter");
      expect((await trailer(page)).muted).toBe(false);
      await skip.click();
      await expect(page.getByTestId("intro")).toHaveCount(0, {
        timeout: 5_000,
      });
      expect(held).toBeGreaterThan(0);
    });

    test("skipping the trailer on a slow connection goes straight to the loading screen", async ({
      page,
      context,
    }) => {
      await seedPlayer(context);
      await pastSchool(context);
      await slowNetwork(page, 20);
      await page.goto("/");
      await page
        .getByTestId("intro")
        .getByRole("button", { name: "Skip" })
        .click({ timeout: 60_000 });
      await expect(page.getByTestId("intro")).toHaveCount(0);
      await expect(page.getByTestId("drive-status")).toBeVisible();
      await expect(page.locator(".front-hub")).toBeVisible({
        timeout: 180_000,
      });
    });
  }

  test("a trailer that cannot play gets out of the way of the game", async ({
    page,
    context,
  }) => {
    await seedPlayer(context);
    await pastSchool(context);
    await page.route("**/intro/trailer.mp4", (route) =>
      route.fulfill({ status: 404 }),
    );
    await page.goto("/");
    await expect(page.locator(".front-hub")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("intro")).toHaveCount(0);
  });
});
