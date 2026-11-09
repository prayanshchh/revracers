import { expect, test } from "@playwright/test";
import { countGpuObjects } from "../../support/gpu-counters.ts";

const softwareGpu = process.platform === "linux";

if (!softwareGpu) {
  test("the whole circuit is on the GPU before the race starts", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await page.addInitScript(countGpuObjects);
    await page.goto("/?autostart=1", { waitUntil: "commit" });
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 360_000 },
    );
    const atStart = await page.evaluate(() => ({ ...window.gpuCounters }));
    expect(atStart.pipelines).toBeGreaterThan(10);
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(9000);
    await page.keyboard.up("ArrowUp");
    await page.keyboard.press("F2");
    await page.waitForTimeout(1500);
    const afterDriving = await page.evaluate(() => ({ ...window.gpuCounters }));
    expect(afterDriving).toEqual(atStart);
  });

  test("the Training Ground builds its crash debris just after the start, so a crash puts no new shader on the GPU", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.addInitScript(countGpuObjects);
    await page.goto("/?track=training-ground&autostart=1");
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 120_000 },
    );
    await page.waitForTimeout(8000);
    const warmed = await page.evaluate(() => window.gpuCounters.pipelines);
    await page.keyboard.down("ArrowUp");
    const speed = page.locator('[data-hud="speed"]');
    await expect
      .poll(async () => Number(await speed.textContent()), {
        timeout: 60_000,
        intervals: [50],
      })
      .toBeGreaterThanOrEqual(150);
    await page.keyboard.down("ArrowLeft");
    await expect(page.locator("[data-hud=toast-title]")).toHaveText(
      /damage|puncture|failure/i,
      { timeout: 15_000 },
    );
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(2000);
    expect(await page.evaluate(() => window.gpuCounters.pipelines)).toBe(
      warmed,
    );
  });
}
