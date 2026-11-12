import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { fieldStrategies } from "../../apps/client/src/game/ai-strategy.ts";
import { planWeekend } from "../../apps/client/src/game/weekend.ts";
import { driveStop, layoutOf } from "../support/pit-drive.ts";
import type { RaceSystems } from "../support/race-systems.ts";
import {
  runUntilComplete,
  sessionKind,
  startField,
  statsOf,
  subset,
  timingOf,
  withStints,
} from "../support/race-weekend.ts";
import { startCircuit, wasm } from "../support/speed-dreams.ts";

const track = "neon-boulevard";
const lapSeconds = 140;

describe.runIf(existsSync(wasm))("street circuit weekend", () => {
  test("every car leaves its garage and sets a clean timed lap", async () => {
    const plan = subset(planWeekend("corvus", 0, null), 6);
    const m = await startField({
      kind: sessionKind.qualifying,
      laps: 0,
      seed: 5,
      plan,
      track,
    });
    runUntilComplete(m, plan.entrants.length * 2 * lapSeconds);
    const laps = timingOf(m, plan.entrants.length).map((c) => c.segmentBest);
    expect(Math.min(...laps)).toBeGreaterThan(0);
    expect(Math.max(...laps) / Math.min(...laps)).toBeLessThan(1.02);
    expect(statsOf(m).walls).toBe(0);
  });

  test("cars stop in the pit lane and rejoin without hitting its walls", async () => {
    const laps = 20;
    const base = subset(planWeekend("corvus", 7, null), 8);
    const plan = withStints(
      base,
      fieldStrategies(base.entrants, base.slots, {
        laps,
        wearScale: 2,
        seed: 4,
      }),
    );
    const m = await startField({
      kind: sessionKind.race,
      laps,
      seed: 4,
      wear: 2,
      plan,
      track,
    });
    runUntilComplete(m, (laps + 1) * lapSeconds);
    const cars = timingOf(m, plan.entrants.length);
    expect(cars.every((car) => car.finished)).toBe(true);
    cars.forEach((car, index) => {
      if (!plan.entrants[index]?.player)
        expect(car.pits).toBeGreaterThanOrEqual(1);
    });
    expect(statsOf(m).walls).toBeLessThanOrEqual(1);
  });

  test("the player turns into the box, is serviced and rejoins the pit exit", async () => {
    const pit = layoutOf(track);
    const lap = driveStop(await startCircuit<RaceSystems>(undefined, track), {
      track,
    });
    expect([...lap.phases]).toEqual(
      expect.arrayContaining(["lane", "boxing", "service", "release"]),
    );
    expect(lap.finished).toBe(true);
    expect(
      Math.min(lap.parkedAlong, pit.length - lap.parkedAlong),
    ).toBeLessThan(1.6);
    expect(Math.abs(lap.parkedLateral - pit.boxLateral)).toBeLessThan(1);
    expect(lap.fuelAfter).toBeGreaterThan(lap.fuelBefore);
    expect(lap.fastestInLane).toBeLessThan(84);
  }, 120_000);
});
