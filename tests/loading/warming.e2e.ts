import { expect, type Page, test } from "@playwright/test";
import { pastSchool, seedPlayer } from "../support/player.ts";
import { startEvent } from "../support/race-event.ts";
import { slowNetwork } from "../support/slow-network.ts";

interface Timed {
  runningAt?: number;
}

const lfsCheckedOut = process.platform !== "linux";
const roadFile = /\/assets\/road-[\w-]+\.glb$/;
const teamCar = /\/assets\/lod-[\w-]+\.glb$/;
const raceFile = /\/assets\/[^/]+\.(?:glb|hdr|bin|xml|txt|json|jpg|png|webp)$/;
const gridPortrait = /\/assets\/portrait-[\w-]+\.webp$/;
const savedFirst = [
  roadFile,
  /\/assets\/circuit-env-[\w-]+\.hdr$/,
  /\/assets\/car-[\w-]+\.glb$/,
  /\/assets\/tyre-condition-[\w-]+\.webp$/,
  /\/assets\/terrain_albedo-[\w-]+\.jpg$/,
];

function pathOf(url: string): string {
  return new URL(url).pathname;
}

async function openHub(page: Page): Promise<void> {
  await page.goto("/?intro=off");
  await expect(page.locator(".front-hub")).toBeVisible({ timeout: 60_000 });
}

async function running(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.body.dataset["driveStatus"] === "running",
    null,
    { timeout: 240_000 },
  );
}

async function noteRunning(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const watch = new MutationObserver(() => {
      if (document.body.dataset["driveStatus"] !== "running") return;
      (window as unknown as Timed).runningAt = performance.now();
      watch.disconnect();
    });
    document.addEventListener("DOMContentLoaded", () => {
      watch.observe(document.body, { attributeFilter: ["data-drive-status"] });
    });
  });
}

function saved(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await (await caches.open("revracers-assets")).keys()).map(
      (request) => new URL(request.url).pathname,
    ),
  );
}

function askedBetween(page: Page, from: number): Promise<string[]> {
  return page.evaluate((start) => {
    const end = (window as unknown as Timed).runningAt ?? Infinity;
    return performance
      .getEntriesByType("resource")
      .filter((entry) => entry.startTime >= start && entry.startTime <= end)
      .map((entry) => new URL(entry.name).pathname);
  }, from);
}

test.describe("saving the race's files ahead of the race", () => {
  test.setTimeout(420_000);

  if (lfsCheckedOut) {
    test("the hub shows the driver's own car without waiting for the other ten teams' cars", async ({
      page,
      context,
    }) => {
      await seedPlayer(context);
      await pastSchool(context);
      await slowNetwork(page, 20);
      const arrived = new Set<string>();
      page.on("requestfinished", (request) => {
        const path = pathOf(request.url());
        if (teamCar.test(path)) arrived.add(path);
      });
      await openHub(page);
      await expect(page.locator(".front-car-loading")).toHaveCount(0, {
        timeout: 120_000,
      });
      expect(arrived.size).toBeGreaterThanOrEqual(1);
      expect(arrived.size).toBeLessThanOrEqual(2);
    });

    test("the circuit starts downloading while the driver is still in the menus, and a file that is still arriving when the race needs it is not downloaded twice", async ({
      page,
      context,
    }) => {
      await seedPlayer(context);
      await pastSchool(context);
      await slowNetwork(page, 60);
      const roads: string[] = [];
      page.on("request", (request) => {
        const path = pathOf(request.url());
        if (roadFile.test(path)) roads.push(path);
      });
      await openHub(page);
      await expect.poll(() => roads.length, { timeout: 60_000 }).toBe(1);
      await page.getByRole("button", { name: /^Race/ }).click();
      await startEvent(page);
      await running(page);
      expect(roads).toHaveLength(1);
    });

    test("once the menus have saved the race's files, pressing Start asks the network for none of them", async ({
      page,
      context,
    }) => {
      await seedPlayer(context);
      await pastSchool(context);
      await noteRunning(page);
      await openHub(page);
      await expect
        .poll(
          async () => {
            const paths = await saved(page);
            return savedFirst.every((file) =>
              paths.some((path) => file.test(path)),
            );
          },
          { timeout: 240_000, intervals: [1000] },
        )
        .toBe(true);
      let count = -1;
      await expect
        .poll(
          async () => {
            const now = (await saved(page)).length;
            const steady = now === count;
            count = now;
            return steady;
          },
          { timeout: 240_000, intervals: [3000] },
        )
        .toBe(true);
      await page.getByRole("button", { name: /^Race/ }).click();
      await expect(page.locator(".ev-circuits")).toBeVisible();
      await page.locator("[data-event=next]").click();
      await page.locator("[data-event=next]").click();
      await expect(page.locator(".ev-settings")).toBeVisible();
      const pressed = await page.evaluate(() => performance.now());
      await page.locator("[data-event=start]").click();
      await running(page);
      const asked = await askedBetween(page, pressed);
      expect(
        asked.filter((path) => raceFile.test(path) && !gridPortrait.test(path)),
      ).toEqual([]);
    });
  }
});
