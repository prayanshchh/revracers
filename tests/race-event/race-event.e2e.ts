import { expect, type Locator, type Page, test } from "@playwright/test";
import { pastSchool, seedPlayer } from "../support/player.ts";

interface DebugEngine {
  trackLength(): number;
  trackLocal(): { rain: number; timeOfDay: number };
  tyreInfo(): { compound: number };
  timing(): { compound: number }[];
  weather(): { lineWater: number; slickLimit: number };
}

function practiceAtHillCountry(): void {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem(
    "revracers.settings",
    JSON.stringify({
      track: "hill-country",
      session: "practice",
      buildUp: false,
      compound: "medium",
      timeOfDay: "from track",
      clouds: "scarce clouds",
      rain: "none",
    }),
  );
}

function dynamicWeekendAtHillCountry(): void {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem(
    "revracers.settings",
    JSON.stringify({
      track: "hill-country",
      session: "weekend",
      qualifying: "skip",
      laps: 5,
      difficulty: 110,
      buildUp: false,
      compound: "medium",
      timeOfDay: "random",
      clouds: "many clouds",
      rain: "dynamic",
    }),
  );
}

const lfsCheckedOut = process.platform !== "linux";
const forecastRolls = 30;

async function openEvent(page: Page, query = ""): Promise<void> {
  await page.goto(`/?intro=off${query}`);
  await expect(page.locator(".front-hub")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Race/ }).click();
  await expect(page.locator(".ev-circuits")).toBeVisible();
}

async function centreOffset(page: Page): Promise<number> {
  const box = await page.locator(".ev-slide.active").boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  return box ? Math.abs(box.x + box.width / 2 - width / 2) : Infinity;
}

async function shown(shot: Locator): Promise<boolean> {
  return shot
    .locator(".ev-shot-layer.in img")
    .last()
    .evaluate((image: HTMLImageElement) => image.naturalWidth > 0)
    .catch(() => false);
}

test.describe("race event screens", () => {
  test.setTimeout(240_000);

  test("arrow keys slide between circuits, every condition shows that circuit in it, and each step keeps its picks", async ({
    page,
    context,
  }) => {
    await seedPlayer(context);
    await pastSchool(context);
    await page.addInitScript(practiceAtHillCountry);
    await openEvent(page);
    const active = page.locator(".ev-slide.active");
    const hero = page.locator(".ev-hero");
    const card = (row: string, option: string) =>
      page.locator(`[data-row=${row}] [data-option="${option}"]`);

    await expect(active).toHaveAttribute("data-track", "hill-country");
    await expect.poll(() => centreOffset(page)).toBeLessThan(30);
    await page.keyboard.press("ArrowRight");
    await expect(active).toHaveAttribute("data-track", "neon-boulevard");
    await expect.poll(() => centreOffset(page)).toBeLessThan(30);
    await page.keyboard.press("ArrowRight");
    await expect(active).toHaveAttribute("data-track", "neon-boulevard");
    await page.keyboard.press("ArrowLeft");
    await expect(active).toHaveAttribute("data-track", "hill-country");
    await expect.poll(() => centreOffset(page)).toBeLessThan(30);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");

    await expect(page.locator(".ev-conditions")).toBeVisible();
    await expect(page.locator(".ev-cond-head")).toContainText(
      "Neon Boulevard Circuit",
    );
    await expect(hero).toHaveAttribute(
      "data-still",
      "neon-boulevard/night-light-cloud",
    );
    if (lfsCheckedOut) await expect.poll(() => shown(hero)).toBe(true);
    await card("weather", "heavy rain").click();
    await expect(hero).toHaveAttribute(
      "data-still",
      "neon-boulevard/night-heavy-rain",
    );
    await card("time", "noon").click();
    await expect(hero).toHaveAttribute(
      "data-still",
      "neon-boulevard/noon-heavy-rain",
    );
    if (lfsCheckedOut) await expect.poll(() => shown(hero)).toBe(true);
    await expect(card("weather", "storm").locator(".ev-shot")).toHaveAttribute(
      "data-still",
      "neon-boulevard/thumb/noon-storm",
    );
    await expect(card("time", "dawn").locator(".ev-shot")).toHaveAttribute(
      "data-still",
      "neon-boulevard/thumb/dawn-heavy-rain",
    );
    await page.keyboard.press("Enter");

    await expect(page.locator(".ev-settings")).toBeVisible();
    const labels = page.locator(".ev-row-label");
    await expect(labels).toHaveText([
      "Session",
      "Starting Tyre",
      "Tyre Wear",
      "Pre-Race Build-Up",
    ]);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(labels).toHaveText([
      "Session",
      "Starting Position",
      "Race Distance",
      "AI Difficulty",
      "Starting Tyre",
      "Tyre Wear",
      "Race Start",
      "Pre-Race Build-Up",
    ]);
    await expect(page.locator(".ev-summary")).toContainText("Wet Track");
    await expect(page.locator(".ev-warn")).toContainText("Slicks");
    await page.locator("[data-tyre=wet]").click();
    await expect(page.locator(".ev-warn")).toHaveText("");
    await expect(page.locator(".ev-summary")).toContainText("Starting on Wet");

    const tyreWeather = page.locator(".ev-row.tyre .ev-tyre-weather");
    await expect(tyreWeather).toHaveText("Heavy Rain · Wet Track");

    await page.keyboard.press("Escape");
    await expect(page.locator(".ev-conditions")).toBeVisible();
    await expect(card("weather", "heavy rain")).toHaveClass(/active/);
    await card("weather", "dynamic").click();
    const forecast = page.locator(".ev-forecast");
    await expect(forecast).toHaveText(/^Forecast: .+ lap \d+/);
    const promised = (await forecast.textContent()) ?? "";
    await page.keyboard.press("Enter");
    await expect(tyreWeather).toHaveText(promised);
    await expect(page.locator(".ev-summary")).toContainText(promised);
    await page.keyboard.press("Escape");
    await card("weather", "heavy rain").click();
    await page.keyboard.press("Escape");
    await expect(active).toHaveAttribute("data-track", "neon-boulevard");
    await page.keyboard.press("Escape");
    await expect(page.locator(".front-hub")).toContainText(
      "Set up a session at Neon Boulevard Circuit",
    );

    await page.reload();
    await expect(page.locator(".front-hub")).toContainText(
      "Set up a session at Neon Boulevard Circuit",
      { timeout: 60_000 },
    );
  });

  if (lfsCheckedOut)
    test("the session runs on the circuit, in the weather and on the tyre picked on the event screens, and keys 1 to 5 pick any tyre for the next stop", async ({
      page,
      context,
    }) => {
      test.setTimeout(420_000);
      await seedPlayer(context);
      await pastSchool(context);
      await page.addInitScript(practiceAtHillCountry);
      await openEvent(page, "&debug");

      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      await page
        .locator('[data-row=weather] [data-option="heavy rain"]')
        .click();
      await page.keyboard.press("Enter");
      await page.locator("[data-tyre=wet]").click();
      await page.locator("[data-event=start]").click();

      await page.waitForFunction(
        () => document.body.dataset["driveStatus"] === "running",
        null,
        { timeout: 360_000 },
      );
      const session = await page.evaluate(() => {
        const engine = (
          window as unknown as { f1Debug: { engine: DebugEngine } }
        ).f1Debug.engine;
        return {
          length: engine.trackLength(),
          compound: engine.tyreInfo().compound,
          ...engine.trackLocal(),
        };
      });
      expect(session.length).toBeGreaterThan(6100);
      expect(session.length).toBeLessThan(6300);
      expect(session.rain).toBe(2);
      expect(session.timeOfDay).toBe(22 * 3600);
      expect(session.compound).toBe(4);

      await page.getByRole("button", { name: /Start$/ }).click();
      const nextStop = page.locator('[data-hud="pit-tyre-options"] .active');
      for (const [key, tyre] of [
        ["4", "Intermediate"],
        ["5", "Wet"],
        ["1", "Soft"],
        ["2", "Medium"],
        ["3", "Hard"],
      ] as const) {
        await page.keyboard.press(key);
        await expect(nextStop).toHaveText(new RegExp(`${tyre}$`));
      }
    });

  if (lfsCheckedOut)
    test("a race weekend that starts in the rain puts the player on the slick they picked, not on intermediates", async ({
      page,
      context,
    }) => {
      test.setTimeout(420_000);
      await seedPlayer(context);
      await pastSchool(context);
      await page.addInitScript(dynamicWeekendAtHillCountry);
      await openEvent(page, "&debug");

      const forecast = page.locator(".ev-forecast");
      let wetStart = false;
      for (let roll = 0; roll < forecastRolls && !wetStart; roll++) {
        if (roll > 0) {
          await page.keyboard.press("Escape");
          await page.keyboard.press("Escape");
          await page.getByRole("button", { name: /^Race/ }).click();
        }
        await page.locator("[data-event=next]").click();
        await expect(forecast).toHaveText(/^Forecast: /);
        wetStart = /Rain at the start/.test(await forecast.innerText());
      }
      expect(wetStart).toBe(true);
      await page.locator("[data-event=next]").click();
      await expect(page.locator(".ev-row.tyre")).toContainText("Medium");
      await page.locator("[data-event=start]").click();

      await page.waitForFunction(
        () => document.body.dataset["driveStatus"] === "running",
        null,
        { timeout: 360_000 },
      );
      const grid = await page.evaluate(() => {
        const engine = (
          window as unknown as { f1Debug: { engine: DebugEngine } }
        ).f1Debug.engine;
        const weather = engine.weather();
        return {
          wet: weather.lineWater >= weather.slickLimit,
          fitted: engine.tyreInfo().compound,
          tower: engine.timing().map((car) => car.compound),
        };
      });
      expect(grid.wet).toBe(true);
      expect(grid.fitted).toBe(1);
      expect(grid.tower[0]).toBe(1);
      expect(grid.tower.slice(1).every((compound) => compound >= 3)).toBe(true);
      await page.getByRole("button", { name: /Start$/ }).click();
      await expect(page.locator('[data-me="1"] .row-tyre')).toHaveText("M", {
        timeout: 30_000,
      });
    });
});
