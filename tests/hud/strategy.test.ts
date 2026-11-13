import { describe, expect, test } from "vitest";
import {
  baseWearPerLap,
  defaultPitLoss,
  observedWear,
  planRace,
  tyreLife,
  twoCompoundLaps,
} from "../../apps/client/src/game/strategy.ts";
import { wearScale } from "../../apps/client/src/game/tyres.ts";

function raceWear(laps: number): number[] {
  return baseWearPerLap(wearScale("real", "race", Math.max(laps, 28)));
}

function lapsOf(plan: { stints: { laps: number }[] }): number {
  return plan.stints.reduce((n, s) => n + s.laps, 0);
}

function checkPlans(laps: number): void {
  const wear = raceWear(laps);
  const plans = planRace({
    laps,
    wearPerLap: wear,
    twoCompounds: laps >= twoCompoundLaps,
    pitLoss: defaultPitLoss,
  });
  expect(plans.length).toBeGreaterThan(0);
  for (const plan of plans) {
    expect(lapsOf(plan)).toBe(laps);
    expect(plan.stops).toHaveLength(plan.stints.length - 1);
    let done = 0;
    plan.stints.forEach((stint, i) => {
      expect(stint.laps).toBeGreaterThan(0);
      expect(stint.laps).toBeLessThanOrEqual(
        tyreLife(wear[stint.compound] ?? 0),
      );
      done += stint.laps;
      if (i < plan.stops.length) expect(plan.stops[i]).toBe(done);
    });
  }
  const times = plans.map((p) => p.time);
  expect(times).toEqual([...times].sort((a, b) => a - b));
}

describe("race strategy planner", () => {
  test("a short race runs the soft tyre to the flag without stopping", () => {
    const [best] = planRace({
      laps: 5,
      wearPerLap: raceWear(5),
      twoCompounds: false,
      pitLoss: defaultPitLoss,
    });
    expect(best?.stints).toEqual([{ compound: 0, laps: 5 }]);
    expect(best?.stops).toEqual([]);
  });

  test("every plan covers the race, keeps each stint inside the tyre's life and stops in order", () => {
    for (const laps of [12, 20, 30, 56]) checkPlans(laps);
  });

  test("a race long enough for the two-compound rule never plans a single compound", () => {
    const plans = planRace({
      laps: 30,
      wearPerLap: raceWear(30),
      twoCompounds: true,
      pitLoss: defaultPitLoss,
    });
    for (const plan of plans)
      expect(new Set(plan.stints.map((s) => s.compound)).size).toBeGreaterThan(
        1,
      );
    expect(plans.some((p) => p.stops.length === 0)).toBe(false);
  });

  test("a full-distance race with real wear needs at least one stop", () => {
    const [best] = planRace({
      laps: 56,
      wearPerLap: raceWear(56),
      twoCompounds: false,
      pitLoss: defaultPitLoss,
    });
    expect(best?.stops.length).toBeGreaterThanOrEqual(1);
  });

  test("a mid-race replan keeps the fitted tyre and stops sooner when it is already worn", () => {
    const wear = raceWear(30);
    const fresh = planRace({
      laps: 20,
      wearPerLap: wear,
      twoCompounds: true,
      pitLoss: defaultPitLoss,
      start: { compound: 1, wear: 0 },
    });
    const worn = planRace({
      laps: 20,
      wearPerLap: wear,
      twoCompounds: true,
      pitLoss: defaultPitLoss,
      start: { compound: 1, wear: 0.6 },
    });
    const [freshBest] = fresh;
    const [wornBest] = worn;
    if (!freshBest || !wornBest) throw new Error("no plan");
    expect(freshBest.stints[0]).toMatchObject({ compound: 1 });
    expect(wornBest.stints[0]).toMatchObject({ compound: 1 });
    expect(wornBest.stops[0]).toBeLessThan(freshBest.stops[0] ?? 0);
    const perLap = wear[1] ?? 1;
    expect(wornBest.stints[0]?.laps).toBeLessThanOrEqual(
      tyreLife(perLap) - 0.6 / perLap,
    );
  });

  test("a driver who wears tyres faster than expected is told to stop earlier", () => {
    const base = raceWear(30);
    const usual = planRace({
      laps: 30,
      wearPerLap: base,
      twoCompounds: true,
      pitLoss: defaultPitLoss,
      start: { compound: 1, wear: 0.1 },
    });
    const harsh = planRace({
      laps: 30,
      wearPerLap: observedWear(base, 1, (base[1] ?? 0) * 1.5),
      twoCompounds: true,
      pitLoss: defaultPitLoss,
      start: { compound: 1, wear: 0.1 },
    });
    expect(harsh[0]?.stops[0] ?? 99).toBeLessThan(usual[0]?.stops[0] ?? 0);
  });

  test("wet tyres give no dry plan to follow", () => {
    expect(
      planRace({
        laps: 10,
        wearPerLap: raceWear(10),
        twoCompounds: false,
        pitLoss: defaultPitLoss,
        start: { compound: 3, wear: 0 },
      }),
    ).toEqual([]);
  });
});
