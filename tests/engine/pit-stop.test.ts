import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  longestStop,
  missedTurnIn,
  planStop,
  stopSeconds,
} from "../../apps/client/src/game/pit-service.ts";
import {
  gradeTurnIn,
  PitStop,
  pitReport,
  type PitControl,
  type PitPhase,
} from "../../apps/client/src/game/pitstop.ts";
import teams from "../../content/cars/teams.json";
import { planWeekend } from "../../apps/client/src/game/weekend.ts";
import { driveStop, launchClearance, layout } from "../support/pit-drive.ts";
import { busyPitStop, wetRush } from "../support/busy-pit.ts";
import { repoRoot } from "../support/repo.ts";
import { sessionKind, startField } from "../support/race-weekend.ts";
import type { RaceSystems } from "../support/race-systems.ts";
import {
  type SpeedDreams,
  startCircuit,
  wasm,
} from "../support/speed-dreams.ts";
import { steerCommand } from "../../apps/client/src/game/pitstop.ts";

interface Placed extends SpeedDreams {
  _sdCarPlace: (
    index: number,
    distance: number,
    lateral: number,
    speed: number,
  ) => void;
  _sdCarsDamage: (pointer: number) => number;
}

async function scrapePitWall() {
  const m = await startCircuit<Placed>();
  m._sdStep(1000);
  m._sdInputSteerDirect(1);
  const parts = m._malloc(64 * 8);
  const damage = () => {
    const count = m._sdCarsDamage(parts);
    return new Float64Array(m.HEAPF64.buffer, parts, count).reduce(
      (sum, part) => sum + part,
      0,
    );
  };
  const out = m._malloc(12);
  const point = (d: number, l: number) => {
    m._sdTrackLocal2Global(d, l, out);
    return Array.from(new Float32Array(m.HEAPF32.buffer, out, 3));
  };
  const lane = layout.fastLane - layout.shift;
  m._sdCarPlace(0, wrap(layout.wallStart + 80), lane, 22);
  m._sdStep(1);
  const before = damage();
  let reached = 0;
  for (let step = 0; step < 1500; step++) {
    const f = new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
    const at = (k: number) => f[k] ?? 0;
    const car = {
      x: at(13),
      y: at(14),
      heading: Math.atan2(at(2), at(1)),
      speed: Math.abs(at(45)),
    };
    reached = Math.max(reached, lane - at(54));
    const aim = point(at(53) + 12, layout.pitWall - layout.shift - 6);
    const command = steerCommand(car, aim, 22);
    m._sdInputAnalog(1, command.steer, command.throttle, command.brake);
    m._sdStep(1);
  }
  return { added: damage() - before, moved: reached };
}

const luck = [0, 0.5, 1];

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("turn-in timing", () => {
  test("grades a press by how far it was from the optimal moment", () => {
    expect(gradeTurnIn(0.05)).toBe("optimal");
    expect(gradeTurnIn(-0.2)).toBe("good");
    expect(gradeTurnIn(0.8)).toBe("early");
    expect(gradeTurnIn(-0.8)).toBe("late");
  });

  test("a perfect turn-in gets a sub two second stop and an optimal one stays near two", () => {
    expect(stopSeconds(0, false, 0.5)).toBeLessThan(2);
    for (const l of luck) {
      expect(stopSeconds(0, false, l)).toBeLessThanOrEqual(2);
      expect(stopSeconds(0.05, false, l)).toBeGreaterThan(1.8);
      expect(stopSeconds(0.1, false, l)).toBeLessThan(2.3);
    }
  });

  test("a worse turn-in never makes the stop shorter", () => {
    let previous = 0;
    for (let error = 0; error <= 3; error += 0.05) {
      const time = stopSeconds(error, false, 0.5);
      expect(time).toBeGreaterThanOrEqual(previous);
      expect(stopSeconds(-error, false, 0.5)).toBe(time);
      previous = time;
    }
  });

  test("a missed turn-in costs a slow stop but not a ten second one", () => {
    for (const l of luck) {
      const missed = stopSeconds(missedTurnIn, false, l);
      expect(missed).toBeGreaterThan(3.5);
      expect(missed).toBeLessThan(7);
    }
  });

  test("a front wing change adds the time a real nose change takes and stays under the cap", () => {
    const optimal = stopSeconds(0.05, true, 0.5);
    expect(optimal).toBeGreaterThan(7);
    expect(optimal).toBeLessThan(8.2);
    for (const l of luck)
      expect(stopSeconds(5, true, l)).toBeLessThanOrEqual(longestStop);
  });

  test("the crew plan finishes exactly when the stop clock says it does", () => {
    const random = seeded(7);
    for (const error of [0, 0.05, 0.2, 0.5, missedTurnIn, 2])
      for (const frontWing of [false, true])
        for (const hold of [0, 5]) {
          const plan = planStop({
            timingError: error,
            frontWing,
            hold,
            service: true,
            random,
          });
          const work = plan.duration - hold;
          expect(work).toBeGreaterThan(1.8);
          expect(work).toBeLessThanOrEqual(longestStop + 1e-9);
          expect(plan.release).toBeLessThan(plan.duration);
          for (const corner of plan.corners) {
            expect(corner.gunOn).toBeGreaterThanOrEqual(hold);
            expect(corner.nutOff).toBeGreaterThan(corner.gunOn);
            expect(corner.tyreOff).toBeGreaterThan(corner.nutOff);
            expect(corner.tyreOn).toBeGreaterThan(corner.tyreOff);
            expect(corner.nutOn).toBeGreaterThan(corner.tyreOn);
            expect(plan.frontDown).toBeGreaterThan(corner.done);
            expect(plan.rearUp).toBeLessThan(corner.nutOff);
          }
          if (plan.wing) expect(plan.frontDown).toBeGreaterThan(plan.wing.done);
        }
  });
});

interface LanePoint {
  distance: number;
  lateral: number;
  speed: number;
}

function wrap(distance: number): number {
  return ((distance % layout.length) + layout.length) % layout.length;
}

function ride(points: LanePoint[]): { phase: PitPhase; limit: number }[] {
  const pit = new PitStop(layout, true, () => 0.5);
  const seen: { phase: PitPhase; limit: number }[] = [];
  let now = 0;
  for (const point of points) {
    now += 1 / 120;
    const distance = wrap(point.distance);
    const control = pit.update(
      {
        distance,
        toMiddle: point.lateral - pit.shiftAt(distance),
        speed: point.speed,
        laneClear: true,
      },
      now,
      false,
    );
    seen.push({ phase: control.phase, limit: control.limit });
  }
  return seen;
}

function route(
  from: number,
  to: number,
  speed: number,
  lateral: (distance: number) => number,
): LanePoint[] {
  const step = (Math.sign(to - from) * Math.max(speed, 0.5)) / 120;
  const count = Math.ceil((to - from) / step);
  return Array.from({ length: count }, (_, k) => {
    const distance = from + step * k;
    return { distance, lateral: lateral(distance), speed };
  });
}

describe("pit lane entry", () => {
  test("driving into the pit lane the wrong way from the exit never starts a stop", () => {
    const exit =
      layout.exit + (layout.exit < layout.boxDistance ? layout.length : 0);
    const backwards = route(
      exit + 20,
      layout.boxDistance,
      15,
      () => layout.fastLane,
    );
    const parked = Array.from({ length: 600 }, () => ({
      distance: layout.boxDistance,
      lateral: layout.boxLateral,
      speed: 0,
    }));
    const seen = ride([...backwards, ...parked]);
    expect(seen.every((s) => s.phase === "track" && s.limit === 0)).toBe(true);
  });

  test("swerving back onto the track at the pit entry cancels the stop", () => {
    const entry = layout.entry;
    const swerve = (distance: number) => {
      const into = distance - (entry - 20);
      if (into < 0) return 2;
      if (into < 40) return 2 + into * 0.2;
      return Math.max(2, 10 - (into - 40) * 0.5);
    };
    const box = layout.boxDistance + layout.length;
    const seen = ride(route(entry - 60, box + 60, 25, swerve));
    expect(seen.some((s) => s.phase === "lane")).toBe(true);
    const back = seen.findIndex(
      (s, k) => k > 0 && s.phase === "track" && seen[k - 1]?.phase === "lane",
    );
    expect(back).toBeGreaterThan(0);
    const after = seen.slice(back);
    expect(after.every((s) => s.phase === "track" && s.limit === 0)).toBe(true);
  });
});

interface Rolling {
  distance: number;
  lateral: number;
  speed: number;
}

const tick = 1 / 120;

function roll(car: Rolling, control: PitControl): void {
  const wanted = control.hold
    ? 0
    : (control.drive?.speed ?? Math.min(control.limit || 22, 22));
  const change = Math.max(-12 * tick, Math.min(8 * tick, wanted - car.speed));
  car.speed = Math.max(0, car.speed + change);
  if (control.drive)
    car.lateral +=
      (control.drive.lateral - car.lateral) *
      Math.min(1, (car.speed * tick) / control.drive.lookahead);
  car.distance = wrap(car.distance + car.speed * tick);
}

function shareBox(heldFor: number) {
  const pit = new PitStop(layout, true, () => 0.5);
  const car = { distance: wrap(layout.entry + 20), lateral: 14.5, speed: 20 };
  const seen: { now: number; control: PitControl; car: Rolling }[] = [];
  let restedAt: number | null = null;
  for (let now = tick; now < 60; now += tick) {
    const taken = restedAt === null || now < restedAt + heldFor;
    const control = pit.update(
      {
        distance: car.distance,
        toMiddle: car.lateral - pit.shiftAt(car.distance),
        speed: car.speed,
        laneClear: true,
        boxTaken: taken,
      },
      now,
      false,
    );
    if (restedAt === null && control.queued && car.speed < 0.05) restedAt = now;
    seen.push({ now, control, car: { ...car } });
    roll(car, control);
  }
  return { seen, restedAt: restedAt ?? Infinity };
}

describe("sharing the team box", () => {
  test("waits behind a teammate in the box, then moves up and gets its stop", () => {
    const heldFor = 4;
    const { seen, restedAt } = shareBox(heldFor);
    const toBox = (car: Rolling) => {
      const gap = wrap(layout.boxDistance - car.distance);
      return gap > layout.length / 2 ? gap - layout.length : gap;
    };
    const waiting = seen.filter(
      (s) => s.now > restedAt && s.now < restedAt + heldFor,
    );
    expect(waiting.length).toBeGreaterThan(heldFor * 100);
    for (const { control, car } of waiting) {
      expect(control.phase).toBe("boxing");
      expect(control.queued).toBe(true);
      expect(control.hold).toBe(true);
      expect(pitReport(control)[0]).toBe(3);
      expect(car.speed).toBeLessThan(0.05);
      expect(toBox(car)).toBeGreaterThan(7.5);
      expect(toBox(car)).toBeLessThan(10.5);
    }
    expect(
      seen.some(
        (s) => s.now < restedAt + heldFor && s.control.phase === "service",
      ),
    ).toBe(false);
    const service = seen.find((s) => s.control.phase === "service");
    expect(service).toBeDefined();
    if (!service) return;
    expect(Math.abs(toBox(service.car))).toBeLessThan(1.6);
    expect(service.control.queued).toBe(false);
    const [phase, left] = pitReport(service.control);
    expect(phase).toBe(4);
    expect(left).toBeCloseTo(service.control.plan?.duration ?? -1, 1);
    expect(seen.some((s) => s.control.phase === "release")).toBe(true);
  });
});

describe.skipIf(!existsSync(wasm))("pit stop in the engine", () => {
  test("parks in the box, services the car and rejoins the fast lane", async () => {
    const lap = driveStop(await startCircuit<RaceSystems>());
    expect([...lap.phases]).toEqual(
      expect.arrayContaining(["lane", "boxing", "service", "release"]),
    );
    expect(lap.finished).toBe(true);
    expect(
      Math.min(lap.parkedAlong, layout.length - lap.parkedAlong),
    ).toBeLessThan(1.6);
    expect(Math.abs(lap.parkedLateral - layout.boxLateral)).toBeLessThan(1);
    expect(lap.fuelAfter).toBeGreaterThan(lap.fuelBefore);
    expect(lap.fuelAfter).toBeGreaterThan(lap.startFuel - 0.5);
    expect(lap.fastestInLane).toBeLessThan(84);
    expect(lap.wingAfter).toBe(lap.wingBefore);
  }, 120_000);

  test("comes into the box straight and leaves without swinging its rear wheels through its own crew or its nose through the next box", async () => {
    const lap = driveStop(await startCircuit<RaceSystems>());
    const clear = launchClearance(lap);
    expect(lap.arrivalDrift).toBeLessThan(0.15);
    expect(clear.rearSwing).toBeLessThan(0.2);
    expect(clear.pastJackMan).toBeGreaterThan(0.6);
    expect(clear.pastCrew).toBeGreaterThan(2.3);
    expect(clear.pastCar).toBeGreaterThan(2.3);
  }, 120_000);

  test("in a rain rush the player leaves the box the moment the stop ends, the field waits, and teammates share one box", async () => {
    const stop = await busyPitStop(3);
    expect(stop.aiInLane).toBeGreaterThanOrEqual(12);
    expect(stop.serviced).toBe(true);
    expect(stop.rejoined).toBe(true);
    expect(stop.held).toBeLessThan(0.5);
    expect(stop.playerContacts).toBe(0);
    expect(stop.playerTouches).toBe(0);
    expect(stop.passedRelease).toBe(0);
    expect(stop.aiTouches).toBe(0);
    expect(stop.stacked).toBeGreaterThanOrEqual(1);
  }, 240_000);

  test("when the whole field dives in on slicks the moment it pours, no stop takes more than two minutes", async () => {
    const rush = await wetRush(2);
    expect(rush.stops).toBeGreaterThanOrEqual(20);
    expect(rush.longest).toBeLessThan(120);
  }, 300_000);

  test("hitting the pit wall inside the pit lane does no damage", async () => {
    const { added, moved } = await scrapePitWall();
    expect(moved).toBeGreaterThan(1.4);
    expect(added).toBe(0);
  }, 120_000);

  test("asking for a new front wing makes the stop longer and fits it", async () => {
    const plain = driveStop(await startCircuit<RaceSystems>());
    const withWing = driveStop(await startCircuit<RaceSystems>(), {
      replaceWing: true,
    });
    expect(withWing.stopTime).toBeGreaterThan(plain.stopTime + 4.5);
    expect(withWing.stopTime).toBeLessThanOrEqual(longestStop);
    expect(withWing.wingAfter).toBe(0);
    expect(withWing.floorAfter).toBeGreaterThan(0.4);
  }, 240_000);

  test("both cars of a team stop in that team's one box, in the middle of its own garage", async () => {
    const m = await startField({ kind: sessionKind.race, laps: 1, seed: 3 });
    const pit = (
      JSON.parse(
        readFileSync(
          path.join(repoRoot, "content/tracks/hill-country/track.json"),
          "utf8",
        ),
      ) as { pitLane: { garageStart: number; garageEnd: number } }
    ).pitLane;
    const span =
      (((pit.garageEnd - pit.garageStart) % layout.length) + layout.length) %
      layout.length;
    const count = Math.floor(span / 14);
    const first = Math.floor((count - teams.length * 2) / 2);
    for (const [garage, team] of teams.entries()) {
      const player = planWeekend(team.id, 10, null).entrants[0];
      expect(player?.garage).toBe(garage);
      const centre =
        pit.garageStart + ((first + garage * 2 + 1) * span) / count;
      for (const seat of [0, 1]) {
        m._sdFieldPlayer(garage, seat, 0);
        const box = m._sdFieldPlayerBox();
        const gap = Math.abs(((box - centre) % layout.length) % layout.length);
        expect(Math.min(gap, layout.length - gap)).toBeLessThan(0.5);
      }
    }
  }, 120_000);
});
