import { expect, type Page, test } from "@playwright/test";
import { pastSchool, seedPlayer } from "../support/player.ts";
import { slowNetwork } from "../support/slow-network.ts";

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

function music(page: Page): Promise<string> {
  return page.evaluate(() => document.body.dataset["music"] ?? "");
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

function watchTrailer(page: Page): string[] {
  const trailers: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/intro/"))
      trailers.push(request.url());
  });
  return trailers;
}

test.describe("opening", () => {
  test.setTimeout(240_000);

  test("a returning driver opens on the hub with no trailer, to the intro music", async ({
    page,
    context,
  }) => {
    await seedPlayer(context);
    await pastSchool(context);
    const trailers = watchTrailer(page);
    await page.goto("/");
    await expect(page.locator(".front-hub")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("[data-school-still]")).toHaveCount(0);
    await expect.poll(() => music(page)).toBe("intro");
    expect(trailers).toEqual([]);
  });

  test("a returning driver sees the screenshots before the game's main script has downloaded", async ({
    page,
    context,
  }) => {
    await pastSchool(context);
    let asked = false;
    let released = false;
    await page.route("**/assets/drive-*.js", async (route) => {
      asked = true;
      await new Promise((resolve) => setTimeout(resolve, 12_000));
      released = true;
      await route.continue().catch(() => undefined);
    });
    await page.goto("/", { waitUntil: "commit" });
    await expect
      .poll(async () => (await loadScreen(page)).slide, { timeout: 8_000 })
      .toMatch(/^\/loading\/\d+\.jpg$/);
    expect(asked).toBe(true);
    expect(released).toBe(false);
  });

  if (process.platform !== "linux") {
    test("a returning driver's slow loads show game screenshots at once, then a fresh count of a steady total and a thin bar that fills to the end when a race loads", async ({
      page,
      context,
    }) => {
      test.setTimeout(420_000);
      await seedPlayer(context);
      await pastSchool(context);
      await page.addInitScript(logLoadBytes);
      await slowNetwork(page, 40);
      const trailers = watchTrailer(page);
      await page.goto("/");
      await expect
        .poll(async () => (await loadScreen(page)).slide, { timeout: 30_000 })
        .toMatch(/^\/loading\/\d+\.jpg$/);
      await expect(page.locator(".front-hub")).toBeVisible({
        timeout: 180_000,
      });
      await page.getByRole("button", { name: /^Race/ }).click();
      await page.locator('[data-menu="start"]').click();
      await expect
        .poll(async () => (await loadScreen(page)).showing, {
          timeout: 30_000,
        })
        .toBe(true);

      const samples: LoadScreen[] = [];
      for (let second = 0; second < 300; second += 1) {
        const sample = await loadScreen(page);
        if (!sample.showing) break;
        if (sample.total > 0) samples.push(sample);
        await page.waitForTimeout(1000);
      }

      expect(samples.length).toBeGreaterThan(10);
      expect(samples[0]?.received).toBeLessThan(8);
      expect(samples[0]?.bar).toBeLessThan(30);
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
      expect(trailers).toEqual([]);

      await page.waitForFunction(
        () => document.body.dataset["driveStatus"] === "running",
      );
    });
  }
});
