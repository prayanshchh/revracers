import { describe, expect, test } from "vitest";
import { FrameGovernor } from "../../apps/client/src/game/frame-governor.ts";

function drive(governor: FrameGovernor, gap: number, frames: number): void {
  for (let i = 0; i < frames; i++) {
    clock += gap;
    governor.tick(clock);
  }
}

let clock = 1000;

describe("frame governor", () => {
  test("lowers the render scale while a 120 Hz screen gets 90 fps, but not below the floor", () => {
    const scales: number[] = [];
    const governor = new FrameGovernor(1000 / 120, (scale) =>
      scales.push(scale),
    );
    drive(governor, 1000 / 90, 2000);
    expect(scales.length).toBeGreaterThan(1);
    expect(scales.every((s, i) => i === 0 || s <= (scales[i - 1] ?? 1))).toBe(
      true,
    );
    expect(governor.scale).toBeCloseTo(0.8, 5);
  });

  test("goes back to full resolution once frames keep up again", () => {
    const governor = new FrameGovernor(1000 / 120, () => undefined);
    drive(governor, 1000 / 90, 600);
    expect(governor.scale).toBeLessThan(1);
    drive(governor, 1000 / 120, 6000);
    expect(governor.scale).toBe(1);
  });

  test("leaves a 60 Hz screen that holds 60 fps at full resolution", () => {
    const scales: number[] = [];
    const governor = new FrameGovernor(1000 / 60, (scale) =>
      scales.push(scale),
    );
    drive(governor, 1000 / 60, 3000);
    expect(scales).toEqual([]);
    expect(governor.scale).toBe(1);
  });

  test("does not count a pause in the menus as a slow frame", () => {
    const scales: number[] = [];
    const governor = new FrameGovernor(1000 / 120, (scale) =>
      scales.push(scale),
    );
    drive(governor, 1000 / 120, 300);
    governor.pause();
    clock += 5000;
    governor.tick(clock);
    drive(governor, 1000 / 120, 300);
    expect(scales).toEqual([]);
  });
});
