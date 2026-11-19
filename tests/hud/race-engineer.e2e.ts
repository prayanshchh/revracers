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

interface Listened {
  spoken: string[];
}

if (process.platform !== "linux") {
  test("the engineer only shows text until the headset is switched on, and the choice is kept", async ({
    page,
  }) => {
    test.setTimeout(780_000);
    await page.addInitScript(() => {
      const spoken: string[] = [];
      Object.assign(window, { spoken });
      window.speechSynthesis.speak = (line: SpeechSynthesisUtterance) => {
        spoken.push(line.text);
      };
      if (sessionStorage.getItem("voice-seeded") !== "1") {
        sessionStorage.setItem("voice-seeded", "1");
        localStorage.setItem(
          "revracers.settings",
          JSON.stringify({
            session: "race",
            laps: 5,
            buildUp: false,
            version: 2,
            engineerVoice: true,
          }),
        );
      }
      sessionStorage.setItem("revracers.autostart", "1");
    });
    const spoken = () =>
      page.evaluate(() => (window as unknown as Listened).spoken.join(" | "));
    const saved = () =>
      page.evaluate(
        () =>
          (
            JSON.parse(localStorage.getItem("revracers.settings") ?? "{}") as {
              engineerVoice?: boolean;
            }
          ).engineerVoice,
      );
    const tab = page.locator("[data-hud=radio-voice]");
    const radio = page.locator("[data-radio-root] [data-radio=text]");
    const race = async () => {
      await page.waitForFunction(
        () => document.body.dataset["driveStatus"] === "running",
        null,
        { timeout: 360_000 },
      );
      await expect(page.locator(".ready-plan").first()).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(page.locator("[data-ready=root]")).toBeHidden();
      await expect(radio).toContainText("Radio check", { timeout: 20_000 });
    };

    await page.goto("/?debug", { waitUntil: "commit" });
    await race();
    await expect(tab).toHaveAttribute("data-voice", "off");
    await expect(tab).toHaveAttribute("aria-pressed", "false");
    expect(await spoken()).toBe("");

    await page.keyboard.press("v");
    await expect(tab).toHaveAttribute("data-voice", "on");
    await expect(tab).toHaveAttribute("aria-pressed", "true");
    expect(await saved()).toBe(true);

    await tab.click();
    await expect(tab).toHaveAttribute("data-voice", "off");
    expect(await saved()).toBe(false);

    await tab.click();
    await expect(tab).toHaveAttribute("data-voice", "on");
    expect(await saved()).toBe(true);
    expect(await spoken()).toBe("");

    await page.reload({ waitUntil: "commit" });
    await race();
    await expect(tab).toHaveAttribute("data-voice", "on");
    expect(await spoken()).toContain("Radio check");
  });
}
