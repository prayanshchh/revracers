import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

const softwareGpu = process.platform === "linux";
const lowestSkyLitLevel = 12;

interface DebugGame {
  engine: { trackPoint(distance: number, lateral: number): number[] };
  scene: {
    setCinematic(pose: { eye: number[]; target: number[]; fov: number }): void;
    sunlight: {
      commit(): void;
      tint: { value: { setRGB(r: number, g: number, b: number): void } };
    };
  };
}

function centreLevel(picture: Buffer): number {
  const image = PNG.sync.read(picture);
  const left = Math.floor(image.width * 0.4);
  const right = Math.floor(image.width * 0.6);
  const top = Math.floor(image.height * 0.4);
  const bottom = Math.floor(image.height * 0.6);
  let sum = 0;
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      const at = (y * image.width + x) * 4;
      sum +=
        0.2126 * (image.data[at] ?? 0) +
        0.7152 * (image.data[at + 1] ?? 0) +
        0.0722 * (image.data[at + 2] ?? 0);
    }
  return sum / ((right - left) * (bottom - top));
}

if (!softwareGpu) {
  test("the sky still lights the road when the sun is put out", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await page.goto("/?autostart=1&debug=1", { waitUntil: "commit" });
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 360_000 },
    );
    await page.addStyleTag({
      content: "[data-testid=hud],[data-hud]{visibility:hidden !important}",
    });
    await page.evaluate(() => {
      const game = (window as unknown as { f1Debug: DebugGame }).f1Debug;
      const sun = game.scene.sunlight;
      const commit = sun.commit.bind(sun);
      sun.commit = () => {
        commit();
        sun.tint.value.setRGB(0, 0, 0);
      };
      const [x = 0, y = 0, z = 0] = game.engine.trackPoint(900, 0);
      game.scene.setCinematic({
        eye: [x + 3, y, z + 24],
        target: [x, y, z],
        fov: 30,
      });
    });
    await page.waitForTimeout(1500);
    expect(centreLevel(await page.screenshot())).toBeGreaterThan(
      lowestSkyLitLevel,
    );
  });
}
