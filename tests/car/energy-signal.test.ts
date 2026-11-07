import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  carField,
  carStride,
  frameIndex,
} from "../../apps/client/src/game/frame-layout.ts";
import {
  carLamps,
  energySignal,
  setLamps,
} from "../../apps/client/src/game/lamps.ts";
import { planWeekend } from "../../apps/client/src/game/weekend.ts";
import {
  accelerateTo,
  energyReader,
  type RaceSystems,
  startRace,
} from "../support/race-systems.ts";
import { sessionKind, startField, subset } from "../support/race-weekend.ts";
import { wasm } from "../support/speed-dreams.ts";

const mode = { none: 0, medium: 1, boost: 3 } as const;
const fullDeploy = 350e3;
const fieldCars = 4;
const stepsPerFrame = 8;

function flatOut(m: RaceSystems, ticks: number) {
  const energy = energyReader(m);
  for (let tick = 0; tick < ticks; tick++) {
    m._sdInputAnalog(1, 0, 1, 0);
    m._sdStep(1);
  }
  const frame = new Float64Array(
    m.HEAPF64.buffer,
    m._sdFrame(),
    frameIndex.size,
  );
  return {
    signal: frame[frameIndex.energySignal] ?? -1,
    motor: energy().motor,
  };
}

function flashesPerSecond(signal: number, brake = 0): number {
  const lamps = carLamps();
  let onsets = 0;
  let lit = 0;
  for (let frame = 0; frame < 600; frame++) {
    setLamps(lamps, brake, signal, 1 / 120);
    if (lamps.lit > lit) onsets++;
    lit = lamps.lit;
  }
  return onsets / 5;
}

describe.runIf(existsSync(wasm))("2026 energy signal lamps", () => {
  test("the player's car shows the signal for each deployment state and none on the brakes", async () => {
    const m = await startRace();
    accelerateTo(m, 40);
    const medium = flatOut(m, 200);
    m._sdEnergyMode(mode.boost);
    const boost = flatOut(m, 300);
    m._sdEnergyMode(mode.none);
    const off = flatOut(m, 2000);
    m._sdInputAnalog(1, 0, 0, 1);
    m._sdStep(50);
    const braking = new Float64Array(
      m.HEAPF64.buffer,
      m._sdFrame(),
      frameIndex.size,
    )[frameIndex.energySignal];
    expect(medium.motor).toBeGreaterThan(0);
    expect(medium.motor).toBeLessThan(fullDeploy * 0.97);
    expect(medium.signal).toBe(energySignal.single);
    expect(boost.motor).toBeGreaterThanOrEqual(fullDeploy * 0.97);
    expect(boost.signal).toBe(energySignal.none);
    expect(Math.abs(off.motor)).toBeLessThan(5e3);
    expect(off.signal).toBe(energySignal.double);
    expect(braking).toBe(energySignal.none);
  });

  test("rivals signal on the straights, super-clip on the back straight and never signal on the brakes", async () => {
    const m = await startField({
      kind: sessionKind.race,
      laps: 3,
      seed: 4,
      plan: subset(planWeekend("corvus", 0, null), fieldCars),
      autopilot: true,
    });
    const memory = m._malloc(fieldCars * carStride * 8);
    const seen = Array.from({ length: fieldCars }, () => new Set<number>());
    let signalOnBrakes = 0;
    for (let frame = 0; frame < 5000; frame++) {
      m._sdStep(stepsPerFrame);
      m._sdCars(memory);
      const data = new Float64Array(
        m.HEAPF64.buffer,
        memory,
        fieldCars * carStride,
      );
      seen.forEach((signals, car) => {
        const at = car * carStride;
        const signal = data[at + carField.energySignal] ?? 0;
        signals.add(signal);
        if ((data[at + carField.brake] ?? 0) > 0.02 && signal !== 0)
          signalOnBrakes++;
      });
    }
    for (const signals of seen) {
      expect(signals.has(energySignal.single)).toBe(true);
      expect(signals.has(energySignal.clipping)).toBe(true);
    }
    expect(signalOnBrakes).toBe(0);
  }, 120_000);

  test("lamps flash once, twice or rapidly per second for each signal and stay lit on the brakes", () => {
    expect(flashesPerSecond(energySignal.none)).toBe(0);
    expect(flashesPerSecond(energySignal.single)).toBe(1);
    expect(flashesPerSecond(energySignal.double)).toBe(2);
    expect(flashesPerSecond(energySignal.clipping)).toBeGreaterThanOrEqual(5);
    expect(flashesPerSecond(energySignal.clipping, 1)).toBeLessThanOrEqual(0.2);
  });
});
