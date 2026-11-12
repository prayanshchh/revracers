import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  difficultyScale,
  planWeekend,
  type WeekendPlan,
} from "../../apps/client/src/game/weekend.ts";
import { Pilot } from "../support/pilot.ts";
import type { RaceSystems } from "../support/race-systems.ts";
import {
  carPoses,
  sessionKind,
  startField,
  timingOf,
  type Weekend,
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

const raceLaps = 3;
const lapIndex = 49;
const speedIndex = 45;
const distanceIndex = 53;
const stopPoints = [3500, 4300];
const watchSeconds = 15;
const holdSteps = 5;
const queueReach = 40;
const carLength = 5.6;
const wakeGap = 20;
const wakeSide = 1.5;
const followReach = 60;
const followSide = 2.6;
const followGap = 8;
const followBrake = 25;
const duelSeconds = 160;

function frameOf(m: Weekend): Float64Array {
  return new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
}

function clock(m: Weekend): number {
  return frameOf(m)[0] ?? 0;
}

async function stopOnLapTwo(at: number): Promise<Weekend> {
  const m = await startField({
    kind: sessionKind.race,
    laps: raceLaps,
    seed: 1,
    plan: planWeekend("corvus", raceLaps, null),
  });
  const frame = () => frameOf(m);
  while (!(
    (frame()[lapIndex] ?? 0) === 2 && (frame()[distanceIndex] ?? 0) > at
  ))
    m._sdStep(sampleSteps);
  m._sdFieldAutopilot(0);
  while (Math.abs(frame()[speedIndex] ?? 0) > 0.5) {
    m._sdInputAnalog(1, 0, 0, 1);
    m._sdStep(1);
  }
  return m;
}

function holdStill(m: Weekend): void {
  const moving = Math.abs(frameOf(m)[speedIndex] ?? 0) > 0.5;
  m._sdInputAnalog(1, 0, 0, moving ? 1 : 0);
  m._sdStep(holdSteps);
}

function queueBehind(m: Weekend) {
  const start = clock(m);
  const waited = new Array<number>(fieldSize).fill(0);
  const arrived = new Set<number>();
  const passed = new Set<number>();
  while (clock(m) < start + watchSeconds) {
    holdStill(m);
    const [player, ...rivals] = carPoses(m, fieldSize);
    if (!player) throw new Error("no pose for the player");
    rivals.forEach((car, k) => {
      const gap = player.distance - car.distance;
      if (gap > 0 && gap < queueReach) {
        arrived.add(k);
        if (Math.abs(car.speed) < crawl)
          waited[k] = (waited[k] ?? 0) + holdSteps / stepsPerSecond;
      }
      if (arrived.has(k) && gap < -carLength) passed.add(k);
    });
  }
  return {
    worst: Math.max(...waited),
    arrived: arrived.size,
    passed: passed.size,
  };
}

async function sitInTheWake() {
  const [player, rival] = planWeekend("corvus", 0, null).entrants;
  if (!player || !rival) throw new Error("season data has no field");
  const m = (await startField({
    kind: sessionKind.race,
    laps: raceLaps,
    seed: 1,
    plan: { entrants: [player, rival], slots: [2, 0] },
    autopilot: false,
    difficulty: difficultyScale(40),
  })) as unknown as Weekend & RaceSystems;
  const length = m._sdTrackLength();
  while (clock(m) < 0) {
    m._sdInputAnalog(1, 0, 0, 1);
    m._sdStep(holdSteps);
  }
  const pilot = new Pilot(m, 0.95);
  let inWake = 0;
  pilot.driveUntil(() => {
    const [me, ai] = carPoses(m, 2);
    if (!me || !ai) throw new Error("no poses for the duel");
    const gap =
      ((ai.distance - me.distance + length * 1.5) % length) - length / 2;
    const side = Math.abs(ai.toMiddle - me.toMiddle);
    const close = gap > 0 && gap < followReach && side < followSide;
    pilot.cap = close
      ? Math.min(
          Math.sqrt(
            Math.max(0, ai.speed ** 2 + 2 * followBrake * (gap - followGap)),
          ),
          Math.abs(ai.speed) + (gap - followGap) * 0.8,
        )
      : Infinity;
    if (
      clock(m) > openingSeconds &&
      gap > carLength &&
      gap < wakeGap &&
      side < wakeSide
    )
      inWake += 1 / stepsPerSecond;
    return clock(m) > duelSeconds;
  });
  return inWake;
}

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

  test("the field drives round the player stopped on the track instead of queueing behind it", async () => {
    for (const at of stopPoints) {
      const { worst, arrived, passed } = queueBehind(await stopOnLapTwo(at));
      expect(arrived).toBeGreaterThan(5);
      expect(worst).toBeLessThan(2);
      expect(passed).toBeGreaterThan(arrived / 2);
    }
  }, 600_000);

  test("an AI car holds its line with the player sitting in its wake instead of pulling aside", async () => {
    expect(await sitInTheWake()).toBeGreaterThan(4);
  }, 600_000);
});
