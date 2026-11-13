import { expect, test } from "@playwright/test";

interface Row {
  index: number;
  position: number;
}

interface Debugged {
  f1Debug: { engine: { timing: () => Row[] } };
  f1Podium: () => Promise<boolean>;
}

if (process.platform !== "linux") {
  test("a player win gets a parc ferme celebration, then the podium, and Enter skips back to the race", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem(
        "revracers.settings",
        JSON.stringify({
          session: "race",
          laps: 5,
          buildUp: false,
          version: 2,
          engineerVoice: false,
        }),
      );
      sessionStorage.setItem("revracers.autostart", "1");
    });
    await page.goto("/?debug", { waitUntil: "commit" });
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 360_000 },
    );
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-ready=root]")).toBeHidden();
    await page.evaluate(() => {
      const { engine } = (window as unknown as Debugged).f1Debug;
      const timing = engine.timing.bind(engine);
      engine.timing = () => {
        const rows = timing();
        const mine = rows.find((row) => row.index === 0);
        const leader = rows.find((row) => row.position === 1);
        if (mine && leader && mine !== leader) {
          leader.position = mine.position;
          mine.position = 1;
        }
        return rows;
      };
    });
    const started = await page.evaluate(() =>
      (window as unknown as Debugged).f1Podium(),
    );
    expect(started).toBe(true);
    const podium = page.locator("[data-podium-root]");
    const label = podium.locator("[data-podium=label]");
    await expect(podium).toBeVisible();
    await expect(label).toHaveText("Race Winner");
    await expect(page.locator("[data-testid=hud]")).toBeHidden();
    await expect(label).toHaveText("Podium", { timeout: 15_000 });
    await expect(label).toHaveText("Third", { timeout: 10_000 });
    await page.keyboard.press("Enter");
    await expect(podium).toBeHidden();
    await expect(page.locator("[data-testid=hud]")).toBeVisible();
    expect(errors).toEqual([]);
  });
}
