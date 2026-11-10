import {
  type BrowserContextOptions,
  devices,
  expect,
  test,
} from "@playwright/test";

const gameFiles = /\.wasm|\/drive-[^/]*\.js|\.bin$|\.glb$|\.ktx2$|\/lite\//;

const phones: [string, BrowserContextOptions][] = [
  ["an Android phone", devices["Pixel 7"]],
  ["an iPhone", devices["iPhone 15"]],
  [
    "a phone asking for the desktop site",
    {
      userAgent: devices["Desktop Chrome"].userAgent,
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      hasTouch: true,
      deviceScaleFactor: 3,
    },
  ],
];

for (const [name, options] of phones)
  test(`${name} is told to play on a computer and downloads none of the game`, async ({
    browser,
  }) => {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    try {
      await page.goto("/");
      await expect(page.getByTestId("phone-home")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        /race on your computer.*steer with your phone/i,
      );
      await expect(page.getByTestId("drive-canvas")).toBeHidden();
      await expect(page.getByTestId("drive-status")).toBeHidden();
      await page.waitForLoadState("networkidle");
      expect(requested.filter((url) => gameFiles.test(url))).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    } finally {
      await context.close();
    }
  });

test("a computer with a touchscreen still loads the game", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    const gameStarts = page.waitForRequest((request) =>
      gameFiles.test(request.url()),
    );
    await page.goto("/?intro=off", { waitUntil: "commit" });
    await gameStarts;
    await expect(page.getByTestId("phone-home")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
