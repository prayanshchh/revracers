import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { planWeekend } from "../../apps/client/src/game/weekend.ts";
import {
  fieldSectorsSize,
  parseFieldSectors,
  traceSlots,
} from "../../apps/client/src/game/field-timing.ts";
import {
  runUntilComplete,
  sessionKind,
  startField,
  subset,
  timingOf,
  type Weekend,
} from "../support/race-weekend.ts";
import { wasm } from "../support/speed-dreams.ts";

const lapSeconds = 125;

interface Timed extends Weekend {
  _sdFieldSectors: (out: number) => number;
  _sdSessionBestTrace: (out: number) => number;
}

function read(m: Timed, size: number, fill: (p: number) => number): number[] {
  const pointer = m._malloc(size * 8);
  fill(pointer);
  const values = Array.from(new Float64Array(m.HEAPF64.buffer, pointer, size));
  m._free(pointer);
  return values;
}

function sectorsOf(m: Timed, cars: number) {
  return parseFieldSectors(
    read(m, fieldSectorsSize(cars), (p) => m._sdFieldSectors(p)),
    cars,
  );
}

function bestTrace(m: Timed): { car: number; trace: number[] } {
  let car = -1;
  const trace = read(m, traceSlots, (p) => {
    car = m._sdSessionBestTrace(p);
    return car;
  });
  return { car, trace };
}

function used(times: number[]): number[] {
  return times.filter((t) => t > 0);
}

describe.runIf(existsSync(wasm))("field sector timing", () => {
  test("race sectors add up to lap times and the session bests are the field's minimum", async () => {
    const laps = 3;
    const plan = subset(planWeekend("corvus", 3, null), 5);
    const cars = plan.entrants.length;
    const m = (await startField({
      kind: sessionKind.race,
      laps,
      seed: 2,
      plan,
    })) as Timed;
    let midLap = sectorsOf(m, cars);
    runUntilComplete(m, (laps + 1) * lapSeconds, () => {
      const now = sectorsOf(m, cars);
      if (now.cars.some((car) => used(car.last).length === 3)) midLap = now;
    });
    const timing = timingOf(m, cars);
    const field = sectorsOf(m, cars);
    field.cars.forEach((car, index) => {
      const row = timing[index];
      if (!row) throw new Error("timing row missing");
      expect(used(car.last)).toHaveLength(3);
      const sum = car.last.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(row.lastLap, 6);
      expect(used(car.best)).toHaveLength(3);
      car.best.slice(0, 3).forEach((best, k) => {
        expect(best).toBeLessThanOrEqual((car.last[k] ?? 0) + 1e-9);
        expect(best).toBeGreaterThan(15);
      });
      const theoretical = car.best.reduce((a, b) => a + b, 0);
      expect(theoretical).toBeLessThanOrEqual(row.best + 1e-6);
    });
    for (let k = 0; k < 3; k++) {
      const times = field.cars.map((car) => car.best[k] ?? Infinity);
      const best = Math.min(...times);
      expect(field.sessionSectors[k]).toBeCloseTo(best, 9);
      expect(field.sessionHolders[k]).toBe(times.indexOf(best));
    }
    const fastest = Math.min(...timing.map((row) => row.best));
    expect(field.fastestLap).toBeCloseTo(fastest, 9);
    expect(field.fastestCar).toBe(
      timing.findIndex((row) => row.best === fastest),
    );
    expect(field.fastestLapNumber).toBeGreaterThanOrEqual(2);
    expect(field.fastestLapNumber).toBeLessThanOrEqual(laps);
    const { car, trace } = bestTrace(m);
    expect(car).toBe(field.fastestCar);
    expect(trace[0]).toBe(0);
    expect(trace.at(-1)).toBeCloseTo(fastest, 9);
    trace.slice(1).forEach((t, k) => {
      expect(t).toBeGreaterThan(trace[k] ?? Infinity);
    });
    expect(midLap.cars.every((c) => used(c.best).length > 0)).toBe(true);
  });

  test("simulated qualifying laps get sectors that sum to the lap and feed the session bests", async () => {
    const plan = subset(planWeekend("corvus", 0, null), 6);
    const cars = plan.entrants.length;
    const m = (await startField({
      kind: sessionKind.qualifying,
      laps: 0,
      seed: 7,
      plan,
      autopilot: false,
    })) as Timed;
    runUntilComplete(m, 1);
    m._sdSessionSimulate();
    const timing = timingOf(m, cars);
    const field = sectorsOf(m, cars);
    const simulated = timing.filter((row) => row.index > 0);
    for (const row of simulated) {
      const car = field.cars[row.index];
      if (!car) throw new Error("sector row missing");
      expect(used(car.best)).toHaveLength(3);
      expect(car.best.reduce((a, b) => a + b, 0)).toBeCloseTo(
        row.segmentBest,
        6,
      );
      expect(car.last).toEqual(car.best);
    }
    expect(used(field.cars[0]?.best ?? [])).toHaveLength(0);
    const fastest = Math.min(...simulated.map((row) => row.segmentBest));
    expect(field.fastestLap).toBeCloseTo(fastest, 9);
    for (let k = 0; k < 3; k++)
      expect(field.sessionSectors[k]).toBeCloseTo(
        Math.min(
          ...simulated.map((row) => field.cars[row.index]?.best[k] ?? 0),
        ),
        9,
      );
    const { trace } = bestTrace(m);
    expect(trace.at(-1)).toBeCloseTo(fastest, 9);
    const shares = trace.map((t) => t / fastest);
    expect(shares[64]).toBeGreaterThan(0.3);
    expect(shares[64]).toBeLessThan(0.7);
  });
});
