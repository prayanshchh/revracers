import { expect, type Page, test } from "@playwright/test";
import { PNG } from "pngjs";

const distanceIndex = 53;
const speedIndex = 45;
const openView = 40;
const straightEnd = 320;
const settle = 1500;
const crawl = 1;
const brakePulse = 120;
const still = 0.05;
const reference: Record<number, [number, number, number]> = {
  2: [198, 216, 228],
  8: [174, 203, 219],
  20: [132, 182, 207],
};
const tint = 0.05;

interface Debugged {
  f1Debug: {
    engine: { frame: () => Float64Array };
    scene: {
      camera: {
        updateMatrixWorld: () => void;
        projectionMatrixInverse: { elements: number[] };
        matrixWorld: { elements: number[] };
      };
    };
  };
}

function rowsAt(elevations: number[]): Record<number, number> {
  const { camera } = (window as unknown as Debugged).f1Debug.scene;
  camera.updateMatrixWorld();
  const inverse = camera.projectionMatrixInverse.elements;
  const world = camera.matrixWorld.elements;
  const height = window.innerHeight;
  const element = (m: number[], i: number) => m[i] ?? 0;
  const elevationOf = (row: number) => {
    const y = 1 - (2 * (row + 0.5)) / height;
    const view = [0, 1, 2, 3].map(
      (r) =>
        element(inverse, 4 + r) * y +
        element(inverse, 8 + r) +
        element(inverse, 12 + r),
    );
    const [x = 0, vy = 0, z = 0, w = 1] = view;
    const up =
      (element(world, 2) * x +
        element(world, 6) * vy +
        element(world, 10) * z) /
      w;
    const across = [0, 1].map(
      (axis) =>
        (element(world, axis) * x +
          element(world, 4 + axis) * vy +
          element(world, 8 + axis) * z) /
        w,
    );
    return (Math.atan2(up, Math.hypot(...across)) * 180) / Math.PI;
  };
  const rows: Record<number, number> = {};
  for (const elevation of elevations) {
    let best = 0;
    for (let row = 0; row < height; row++)
      if (
        Math.abs(elevationOf(row) - elevation) <
        Math.abs(elevationOf(best) - elevation)
      )
        best = row;
    rows[elevation] = best;
  }
  return rows;
}

async function speedOf(page: Page): Promise<number> {
  return page.evaluate(
    (index) =>
      Math.abs(
        (window as unknown as Debugged).f1Debug.engine.frame()[index] ?? 0,
      ),
    speedIndex,
  );
}

async function brakeWithoutLocking(page: Page): Promise<void> {
  for (let pulse = 0; pulse < 200 && (await speedOf(page)) > crawl; pulse++) {
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(brakePulse);
    await page.keyboard.up("ArrowDown");
    await page.waitForTimeout(brakePulse);
  }
}

async function slowerThan(page: Page, speed: number): Promise<void> {
  await page.waitForFunction(
    ([index, limit]) =>
      Math.abs(
        (window as unknown as Debugged).f1Debug.engine.frame()[index] ?? 1,
      ) < limit,
    [speedIndex, speed] as const,
    { timeout: 60_000, polling: 16 },
  );
}

function skyAt(png: PNG, row: number): [number, number, number] {
  const centre = Math.floor(png.width / 2);
  const channel = (c: number) => {
    const values: number[] = [];
    for (let x = centre - 16; x < centre + 16; x++)
      values.push(png.data[(row * png.width + x) * 4 + c] ?? 0);
    return values.sort((a, b) => a - b)[values.length >> 1] ?? 0;
  };
  return [channel(0), channel(1), channel(2)];
}

if (process.platform !== "linux") {
  test("Driving School's sky is the reference clear blue, deepening from a pale horizon", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/?autostart&debug&track=training-ground");
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 120_000 },
    );
    await page.keyboard.down("ArrowUp");
    await page.waitForFunction(
      ([index, from, to]) => {
        const distance =
          (window as unknown as Debugged).f1Debug.engine.frame()[index] ?? 0;
        return distance >= from && distance < to;
      },
      [distanceIndex, openView, straightEnd] as const,
      { timeout: 60_000, polling: 16 },
    );
    await page.keyboard.up("ArrowUp");
    await brakeWithoutLocking(page);
    await page.keyboard.down("ArrowDown");
    await slowerThan(page, still);
    await page.keyboard.up("ArrowDown");
    await page.waitForTimeout(settle);
    await page.addStyleTag({
      content:
        "* { visibility: hidden !important; transition: none !important; animation: none !important; } canvas[data-testid=drive-canvas] { visibility: visible !important; }",
    });
    const elevations = Object.keys(reference).map(Number);
    const rows = await page.evaluate(rowsAt, elevations);
    const png = PNG.sync.read(await page.screenshot());
    const seen = elevations.map((elevation) =>
      skyAt(png, rows[elevation] ?? 0),
    );
    elevations.forEach((elevation, i) => {
      const [r, g, b] = seen[i] ?? [0, 0, 0];
      const [wr, wg, wb] = reference[elevation] ?? [0, 0, 0];
      expect(
        Math.abs(r / b - wr / wb),
        `red at ${String(elevation)}°`,
      ).toBeLessThan(tint);
      expect(
        Math.abs(g / b - wg / wb),
        `green at ${String(elevation)}°`,
      ).toBeLessThan(tint);
    });
    const brightness = seen.map(([r, g, b]) => r + g + b);
    expect(brightness[0]).toBeGreaterThan(brightness[1] ?? 0);
    expect(brightness[1]).toBeGreaterThan(brightness[2] ?? 0);
  });
}
