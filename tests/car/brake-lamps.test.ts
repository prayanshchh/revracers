import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  carField,
  carStride,
} from "../../apps/client/src/game/frame-layout.ts";
import {
  brakeLampHold,
  carLamps,
  energySignal,
  setLamps,
} from "../../apps/client/src/game/lamps.ts";
import { planWeekend } from "../../apps/client/src/game/weekend.ts";
import { sessionKind, startField, subset } from "../support/race-weekend.ts";
import { wasm } from "../support/speed-dreams.ts";

const cars = 4;
const stepsPerFrame = 8;
const frameSeconds = stepsPerFrame / 500;
const frames = 3000;
const pressedFrom = 0.05;

class LampWatch {
  readonly lamp = carLamps();
  pedalFlips = 0;
  lampFlips = 0;
  shortest = Infinity;
  missed = 0;
  stuck = 0;
  private pressed = false;
  private lit = false;
  private litAt = 0;
  private pressedAt = -Infinity;

  frame(index: number, brake: number): void {
    setLamps(this.lamp, brake, energySignal.none, frameSeconds);
    const lit = this.lamp.lit === 1;
    const pressed = brake > pressedFrom;
    if (pressed) this.pressedAt = index;
    if (pressed && !lit) this.missed++;
    if (lit && (index - this.pressedAt) * frameSeconds > brakeLampHold)
      this.stuck++;
    if (pressed !== this.pressed) this.pedalFlips++;
    if (lit !== this.lit) this.lampChanged(index, lit);
    this.pressed = pressed;
    this.lit = lit;
  }

  private lampChanged(index: number, lit: boolean): void {
    this.lampFlips++;
    if (lit) this.litAt = index;
    else
      this.shortest = Math.min(
        this.shortest,
        (index - this.litAt) * frameSeconds,
      );
  }
}

describe.runIf(existsSync(wasm))("rival brake lamps", () => {
  test("light whenever a rival brakes, stay lit through its pulsed braking and go out once it lets go", async () => {
    const m = await startField({
      kind: sessionKind.race,
      laps: 3,
      seed: 4,
      plan: subset(planWeekend("corvus", 0, null), cars),
      autopilot: true,
    });
    const memory = m._malloc(cars * carStride * 8);
    const watches = Array.from({ length: cars }, () => new LampWatch());
    for (let frame = 0; frame < frames; frame++) {
      m._sdStep(stepsPerFrame);
      m._sdCars(memory);
      const data = new Float64Array(m.HEAPF64.buffer, memory, cars * carStride);
      watches.forEach((watch, car) => {
        watch.frame(frame, data[car * carStride + carField.brake] ?? 0);
      });
    }
    for (const watch of watches) {
      expect(watch.missed).toBe(0);
      expect(watch.stuck).toBe(0);
      expect(watch.lampFlips).toBeGreaterThan(2);
      expect(watch.pedalFlips).toBeGreaterThan(4 * watch.lampFlips);
      expect(watch.shortest).toBeGreaterThanOrEqual(
        brakeLampHold - frameSeconds,
      );
    }
  }, 120_000);
});
