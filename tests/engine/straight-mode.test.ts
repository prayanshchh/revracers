import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  carField,
  carStride,
  frameIndex,
} from "../../apps/client/src/game/frame-layout.ts";
import { raceControlState } from "../../apps/client/src/game/stewards.ts";
import { planWeekend } from "../../apps/client/src/game/weekend.ts";
import {
  energyReader,
  type RaceSystems,
  startRace,
} from "../support/race-systems.ts";
import {
  sessionKind,
  startField,
  subset,
  type Weekend,
} from "../support/race-weekend.ts";
import { repoRoot } from "../support/repo.ts";
import { wasm } from "../support/speed-dreams.ts";

interface Placed extends RaceSystems {
  _sdCarPlace: (
    index: number,
    distance: number,
    lateral: number,
    speed: number,
  ) => void;
  _sdWeatherSet: (rain: number, line: number, off: number) => void;
}

interface Zone {
  start: number;
  span: number;
}

const circuit = JSON.parse(
  readFileSync(
    path.join(repoRoot, "content/tracks/hill-country/circuit-map.json"),
    "utf8",
  ),
) as { straights: [number, number][]; track: { length: number } };
const lapLength = circuit.track.length;
const wrap = (d: number) => ((d % lapLength) + lapLength) % lapLength;
const zones: Zone[] = circuit.straights.map(([start, end]) => ({
  start,
  span: wrap(end - start),
}));
const [mainZone, backZone] = zones as [Zone, Zone];
const tenToEleven = 2240;
const edge = 2;
const fieldCars = 4;
const stepsPerFrame = 8;
const neutralised: number[] = [
  raceControlState.vsc,
  raceControlState.vscEnding,
  raceControlState.safetyCar,
  raceControlState.safetyCarIn,
  raceControlState.red,
];

const into = (zone: Zone, distance: number) => wrap(distance - zone.start);
const deepInside = (zone: Zone, distance: number) => {
  const d = into(zone, distance);
  return d >= edge && d <= zone.span - edge;
};
const inAnyZone = (distance: number) =>
  zones.some((zone) => into(zone, distance) <= zone.span);

async function placed(
  distance: number,
  speed: number,
  prepare?: (m: Placed) => void,
) {
  const m = (await startRace()) as Placed;
  prepare?.(m);
  m._sdStep(1000);
  m._sdCarPlace(0, distance, 0, speed);
  m._sdStep(1);
  const energy = energyReader(m);
  const sample = (throttle: number) => {
    m._sdInputAnalog(1, 0, throttle, 0);
    m._sdStep(1);
    const frame = new Float64Array(
      m.HEAPF64.buffer,
      m._sdFrame(),
      frameIndex.size,
    );
    const now = energy();
    return {
      distance: frame[frameIndex.distFromStart] ?? 0,
      speed: frame[frameIndex.speed] ?? 0,
      rear: frame[frameIndex.rearFlap] ?? 0,
      front: now.straight,
      enabled: now.enabled,
      lowGrip: now.lowGrip,
    };
  };
  return { m, sample };
}

function carsOf(m: Weekend, memory: number) {
  m._sdCars(memory);
  const data = new Float64Array(
    m.HEAPF64.buffer,
    memory,
    fieldCars * carStride,
  );
  return Array.from({ length: fieldCars }, (_, car) => ({
    distance: data[car * carStride + carField.distance] ?? 0,
    flap: data[car * carStride + carField.rearFlap] ?? 0,
  }));
}

function controlState(m: Weekend): number {
  const pointer = m._malloc(16 * 8);
  m._sdRaceControlInfo(pointer);
  const state = new Float64Array(m.HEAPF64.buffer, pointer, 1)[0] ?? 0;
  m._free(pointer);
  return state;
}

function raceField(): Promise<Weekend> {
  return startField({
    kind: sessionKind.race,
    laps: 3,
    seed: 4,
    plan: subset(planWeekend("corvus", 0, null), fieldCars),
    autopilot: true,
  });
}

function leaderOutsideZones(cars: { distance: number }[]): number {
  return Math.max(
    ...cars.map((car) => (inAnyZone(car.distance) ? 0 : car.distance)),
  );
}

describe.runIf(existsSync(wasm))("2026 Straight Mode activation zones", () => {
  test("flat out down the main straight the wings open only once fully inside the zone and are shut before it ends, without braking", async () => {
    const { sample } = await placed(mainZone.start - 40, 55);
    const run = [];
    for (let tick = 0; tick < 12000; tick++) {
      const now = sample(1);
      const along = wrap(now.distance - (mainZone.start - 40)) - 40;
      if (along > mainZone.span + 20) break;
      run.push({ ...now, along });
    }
    expect(run.at(-1)?.along ?? 0).toBeGreaterThan(mainZone.span);
    const outside = run.filter(
      (s) => s.along < edge || s.along > mainZone.span - edge,
    );
    const inside = run.filter(
      (s) => s.along >= edge && s.along <= mainZone.span - edge,
    );
    expect(outside.length).toBeGreaterThan(100);
    expect(Math.max(...outside.map((s) => Math.max(s.rear, s.front)))).toBe(0);
    expect(Math.max(...inside.map((s) => s.rear))).toBe(1);
    expect(Math.max(...inside.map((s) => s.front))).toBe(1);
  });

  test("stays shut flat out at 220 km/h on the dead-straight run from Turn 10 to Turn 11, which is not a zone", async () => {
    expect(inAnyZone(tenToEleven + 100)).toBe(false);
    const { sample } = await placed(tenToEleven, 61);
    let widest = 0;
    let slowest = Infinity;
    for (let tick = 0; tick < 500; tick++) {
      const now = sample(1);
      widest = Math.max(widest, now.rear, now.front);
      slowest = Math.min(slowest, now.speed);
    }
    expect(slowest * 3.6).toBeGreaterThan(200);
    expect(widest).toBe(0);
  });

  test("in Low Grip Conditions only the front flaps open; the rear wing stays in Corner Mode", async () => {
    const { sample } = await placed(mainZone.start + 30, 60, (m) => {
      m._sdWeatherSet(1, 0.5, 0.5);
    });
    let front = 0;
    let rear = 0;
    let lowGrip = false;
    for (let tick = 0; tick < 400; tick++) {
      const now = sample(1);
      front = Math.max(front, now.front);
      rear = Math.max(rear, now.rear);
      lowGrip = now.lowGrip;
    }
    expect(lowGrip).toBe(true);
    expect(front).toBe(1);
    expect(rear).toBe(0);
  });

  test("with the assist off, X pressed before the zone is ignored, X inside the zone opens it, and lifting shuts it", async () => {
    const { m, sample } = await placed(mainZone.start - 60, 55, (engine) => {
      engine._sdEnergyStraight(0, 0);
    });
    m._sdEnergyStraight(0, 1);
    let early = 0;
    let now = sample(1);
    for (
      let tick = 0;
      tick < 4000 && !deepInside(mainZone, now.distance - 30);
      tick++
    ) {
      now = sample(1);
      early = Math.max(early, now.rear);
    }
    expect(deepInside(mainZone, now.distance)).toBe(true);
    expect(now.enabled).toBe(true);
    expect(early).toBe(0);
    m._sdEnergyStraight(0, 1);
    for (let tick = 0; tick < 300; tick++) now = sample(1);
    expect(now.rear).toBe(1);
    for (let tick = 0; tick < 150; tick++) now = sample(0.3);
    expect(now.rear).toBe(0);
  });

  test("on race day nobody opens on the run to Turn 1, every car opens on the back straight, and no flap is ever open outside a zone", async () => {
    const m = await raceField();
    const memory = m._malloc(fieldCars * carStride * 8);
    const pastTurnOne = Array.from({ length: fieldCars }, () => false);
    const openedOnBack = Array.from({ length: fieldCars }, () => 0);
    let openBeforeTurnOne = 0;
    let openOutside = 0;
    for (let frame = 0; frame < 12000; frame++) {
      m._sdStep(stepsPerFrame);
      carsOf(m, memory).forEach((car, i) => {
        if (!inAnyZone(car.distance)) pastTurnOne[i] = true;
        if (!pastTurnOne[i] && car.flap > 0) openBeforeTurnOne++;
        if (!zones.some((z) => deepInside(z, car.distance)) && car.flap > 0)
          openOutside++;
        if (pastTurnOne[i] && deepInside(backZone, car.distance))
          openedOnBack[i] = Math.max(openedOnBack[i] ?? 0, car.flap);
      });
      if (openedOnBack.every((open) => open === 1)) break;
    }
    expect(openedOnBack).toEqual(Array.from({ length: fieldCars }, () => 1));
    expect(openBeforeTurnOne).toBe(0);
    expect(openOutside).toBe(0);
  }, 300_000);

  test("under a Virtual Safety Car race control keeps every wing shut, even on the back straight", async () => {
    const m = await raceField();
    const memory = m._malloc(fieldCars * carStride * 8);
    let deployed = false;
    const neutral: { distance: number; flap: number }[] = [];
    for (let frame = 0; frame < 12000; frame++) {
      m._sdStep(stepsPerFrame);
      const cars = carsOf(m, memory);
      const leader = leaderOutsideZones(cars);
      if (!deployed && leader > 1800 && leader < backZone.start)
        deployed = m._sdRaceControlDeploy(1) === 1;
      if (neutralised.includes(controlState(m))) neutral.push(...cars);
      else if (deployed && neutral.length > 0) break;
    }
    const neutralFramesInZone = neutral.filter((car) =>
      deepInside(backZone, car.distance),
    ).length;
    const openWhileNeutral = neutral.filter((car) => car.flap > 0).length;
    expect(deployed).toBe(true);
    expect(neutralFramesInZone).toBeGreaterThan(100);
    expect(openWhileNeutral).toBe(0);
  }, 300_000);
});
