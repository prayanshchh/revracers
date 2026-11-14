import { expect, test } from "@playwright/test";

interface Debugged {
  f1Debug: { engine: { tyreInfo: () => { compound: number } } };
}

const letters = ["S", "M", "H", "I", "W"];

if (process.platform !== "linux") {
  test("the strategy card keeps the tyre picked in settings until a plan is picked, then fits that plan's tyres, and the engineer gives the race's weather", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await page.addInitScript(() => {
      localStorage.setItem(
        "revracers.settings",
        JSON.stringify({
          session: "race",
          laps: 5,
          buildUp: false,
          version: 2,
          compound: "hard",
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
    const plans = page.locator(".ready-plan");
    await expect(plans).toHaveCount(3);
    const compound = () =>
      page.evaluate(
        () =>
          (window as unknown as Debugged).f1Debug.engine.tyreInfo().compound,
      );
    const firstLetter = async (index: number) =>
      plans.nth(index).locator(".ready-stints i").first().textContent();
    const starts = await Promise.all([0, 1, 2].map(firstLetter));
    const hard = starts.indexOf("H");
    expect(hard).toBeGreaterThan(0);
    await expect(page.locator(".ready-plan.on")).toHaveCount(1);
    await expect(plans.nth(hard)).toHaveClass(/on/);
    expect(letters[await compound()]).toBe("H");
    await page.keyboard.press("1");
    await expect(plans.first()).toHaveClass(/on/);
    expect(letters[await compound()]).toBe(starts[0]);
    expect(starts[0]).not.toBe("H");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-ready=root]")).toBeHidden();
    const radio = page.locator("[data-radio-root] [data-radio=text]");
    await expect(radio).toHaveText(
      "Weather for the race: dry all race, no rain expected.",
      { timeout: 20_000 },
    );
  });
}
