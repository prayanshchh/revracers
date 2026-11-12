import { describe, expect, test } from "vitest";
import {
  fieldStrategies,
  type StintPlan,
} from "../../apps/client/src/game/ai-strategy.ts";
import { baseWearPerLap } from "../../apps/client/src/game/strategy.ts";

const cars = 22;
const entrants = Array.from({ length: cars }, (_, i) => ({
  teamIndex: Math.floor(i / 2),
  player: i === 0,
}));
const slots = entrants.map((_, i) => i);
const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

function race(laps: number, wearScale: number, seed: number) {
  return fieldStrategies(entrants, slots, { laps, wearScale, seed });
}

function key(plan: StintPlan[]): string {
  return plan.map((stint) => String(stint.compound)).join("");
}

function stintLaps(plan: StintPlan[], laps: number): number[] {
  return plan.map((stint, i) =>
    Math.round(((plan[i + 1]?.from ?? 1) - stint.from) * laps),
  );
}

describe("AI race strategies", () => {
  test("the player gets no AI plan and every rival gets one", () => {
    const plans = race(30, 1, 7);
    expect(plans[0]).toEqual([]);
    for (const plan of plans.slice(1)) expect(plan.length).toBeGreaterThan(0);
  });

  test("a 30-40 lap race mixes soft, medium and hard starters and several strategies", () => {
    for (const laps of [30, 40])
      for (const seed of seeds) {
        const plans = race(laps, 1, seed).slice(1);
        const starts = new Set(plans.map((plan) => plan[0]?.compound));
        expect(starts.size).toBeGreaterThanOrEqual(2);
        expect(new Set(plans.map(key)).size).toBeGreaterThanOrEqual(3);
      }
    const everyStart = new Set(
      seeds.flatMap((seed) =>
        race(35, 1, seed).map((plan) => plan[0]?.compound),
      ),
    );
    expect([...everyStart].filter((c) => c !== undefined).sort()).toEqual([
      0, 1, 2,
    ]);
  });

  test("in a 10-lap race a few cars gamble on a stop, but never most of the field", () => {
    const stoppers = seeds.map(
      (seed) =>
        race(10, 1, seed)
          .slice(1)
          .filter((plan) => plan.length > 1).length,
    );
    expect(stoppers.filter((n) => n > 0).length).toBeGreaterThanOrEqual(
      seeds.length / 2,
    );
    expect(Math.max(...stoppers)).toBeLessThanOrEqual(6);
    for (const seed of seeds)
      for (const plan of race(5, 1, seed)) expect(plan.length).toBeLessThan(2);
  });

  test("from 20 laps every plan uses two dry compounds and stops in race order", () => {
    for (const seed of seeds)
      for (const plan of race(24, 2, seed).slice(1)) {
        expect(
          new Set(plan.map((stint) => stint.compound)).size,
        ).toBeGreaterThanOrEqual(2);
        expect(plan[0]?.from).toBe(0);
        plan.slice(1).forEach((stint, i) => {
          expect(stint.from).toBeGreaterThan(plan[i]?.from ?? 0);
          expect(stint.from).toBeLessThan(1);
        });
      }
  });

  test("no stint runs the tyres into the cliff where the AI starts sliding off", () => {
    for (const [laps, scale] of [
      [10, 2],
      [20, 2],
      [56, 1],
    ] as const) {
      const wear = baseWearPerLap(scale);
      for (const seed of seeds)
        for (const plan of race(laps, scale, seed).slice(1))
          stintLaps(plan, laps).forEach((n, i) => {
            const compound = plan[i]?.compound ?? 0;
            expect(n * (wear[compound] ?? 0)).toBeLessThanOrEqual(0.7);
          });
    }
  });

  test("teammates share a team strategy more often than cars from different teams", () => {
    let mates = 0;
    let rivals = 0;
    for (const seed of seeds) {
      const plans = race(40, 1, seed);
      for (let team = 1; team < cars / 2; team++) {
        if (key(plans[2 * team] ?? []) === key(plans[2 * team + 1] ?? []))
          mates++;
        if (
          key(plans[2 * team + 1] ?? []) ===
          key(plans[(2 * team + 2) % cars] ?? [])
        )
          rivals++;
      }
    }
    expect(mates).toBeGreaterThan(rivals * 1.5);
  });

  test("stops spread over several laps, and teammates on one plan never stop together", () => {
    for (const seed of seeds) {
      const plans = race(20, 2, seed);
      const firstStops = plans.flatMap((plan) =>
        plan[1] ? [Math.round(plan[1].from * 20)] : [],
      );
      expect(new Set(firstStops).size).toBeGreaterThanOrEqual(4);
      for (let team = 1; team < cars / 2; team++) {
        const a = plans[2 * team] ?? [];
        const b = plans[2 * team + 1] ?? [];
        if (key(a) === key(b) && a.length > 1)
          expect(a.slice(1).map((s) => s.from)).not.toEqual(
            b.slice(1).map((s) => s.from),
          );
      }
    }
  });

  test("each race draws new strategies", () => {
    const first = race(30, 1, 11).map(key).join(",");
    const differs = seeds.filter(
      (seed) => race(30, 1, seed).map(key).join(",") !== first,
    );
    expect(differs.length).toBeGreaterThan(seeds.length - 3);
  });
});
