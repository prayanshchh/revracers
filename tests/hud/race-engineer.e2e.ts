import { expect, test } from "@playwright/test";

interface Debugged {
  f1Debug: { engine: { tyreInfo: () => { compound: number } } };
}

const letters = ["S", "M", "H", "I", "W"];
const names = ["soft", "medium", "hard", "intermediate", "wet"];

if (process.platform !== "linux") {
  test("the strategy card fits the chosen plan's tyres and the engineer briefs that plan", async ({
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
    await expect(plans.first()).toHaveClass(/on/);
    const compound = () =>
      page.evaluate(
        () =>
          (window as unknown as Debugged).f1Debug.engine.tyreInfo().compound,
      );
    const firstLetter = async (index: number) =>
      plans.nth(index).locator(".ready-stints i").first().textContent();
    expect(letters[await compound()]).toBe(await firstLetter(0));
    await page.keyboard.press("2");
    await expect(plans.nth(1)).toHaveClass(/on/);
    expect(letters[await compound()]).toBe(await firstLetter(1));
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-ready=root]")).toBeHidden();
    const radio = page.locator("[data-radio-root] [data-radio=text]");
    await expect(radio).toContainText("Radio check", { timeout: 20_000 });
    await expect(radio).toContainText(names[await compound()] ?? "-");
  });
}
