import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  difficultyScale,
  planWeekend,
  type WeekendPlan,
} from "../../apps/client/src/game/weekend.ts";
import {
  carPoses,
  sessionKind,
  startField,
  timingOf,
} from "../support/race-weekend.ts";
import { wasm } from "../support/speed-dreams.ts";

const laps = 5;
const stepsPerSecond = 500;
const tyreFields = 64;
const wheelFields = 15;
const mediumTop = 105;
const fieldSize = 22;
const turnOne = { from: 560, to: 760 };
const crawl = 5;
const openingSeconds = 45;
const sampleSteps = 20;

function alone(): WeekendPlan {
  const [player] = planWeekend("corvus", 0, null).entrants;
  if (!player) throw new Error("season data has no field");
  return { entrants: [player], slots: [0] };
}

async function soloRace(difficulty: number) {
  const m = await startField({
    kind: sessionKind.race,
    laps,
    seed: 1,
    plan: alone(),
    difficulty: difficultyScale(difficulty),
  });
  const tyres = m._malloc(tyreFields * 8);
  const lapTimes: number[] = [];
  const fronts: number[] = [];
  let seen = 0;
  for (let second = 0; second < (laps + 1) * 125; second++) {
    m._sdStep(stepsPerSecond);
    const [car] = timingOf(m, 1);
    if (!car) throw new Error("no timing for the car");
    if (car.laps !== seen) {
      if (seen > 1) lapTimes.push(car.lastLap);
      seen = car.laps;
    }
    if (car.laps >= laps - 1 && !car.finished) {
      m._sdTyresInfo(tyres);
      const v = new Float64Array(m.HEAPF64.buffer, tyres, tyreFields);
      fronts.push(((v[4] ?? 0) + (v[4 + wheelFields] ?? 0)) / 2);
    }
    if (car.finished) break;
  }
  const front = fronts.reduce((sum, t) => sum + t, 0) / fronts.length;
  return { lapTimes, best: Math.min(...lapTimes), front };
}

async function turnOneOnLapOne() {
  const m = await startField({ kind: sessionKind.race, laps, seed: 1 });
  const slowest = new Array<number>(fieldSize).fill(Infinity);
  for (
    let step = 0;
    step < openingSeconds * stepsPerSecond;
    step += sampleSteps
  ) {
    m._sdStep(sampleSteps);
    carPoses(m, fieldSize).forEach((car, i) => {
      if (car.distance > turnOne.from && car.distance < turnOne.to)
        slowest[i] = Math.min(slowest[i] ?? Infinity, Math.abs(car.speed));
    });
  }
  return slowest;
}

describe.runIf(existsSync(wasm))("AI pace and racecraft", () => {
  test("each difficulty step is worth about a tenth of a second a lap", async () => {
    const slowest = await soloRace(40);
    const fastest = await soloRace(110);
    expect(slowest.best - fastest.best).toBeGreaterThan(5.5);
    expect(slowest.best - fastest.best).toBeLessThan(8.5);
  });

  test("at full race pace the tyres run warm but never cook, so the laps hold up", async () => {
    const { lapTimes, best, front } = await soloRace(110);
    expect(best).toBeLessThan(102);
    expect(front).toBeGreaterThan(mediumTop);
    expect(front).toBeLessThan(mediumTop + 15);
    expect(Math.max(...lapTimes) - best).toBeLessThan(2.5);
  });

  test("the pack goes through turn one on the opening lap without queueing to a crawl", async () => {
    const slowest = await turnOneOnLapOne();
    expect(slowest.every(Number.isFinite)).toBe(true);
    expect(Math.min(...slowest)).toBeGreaterThan(2.5);
    expect(slowest.filter((speed) => speed < crawl).length).toBeLessThanOrEqual(
      5,
    );
  });
});
