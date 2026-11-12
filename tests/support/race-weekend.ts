import {
  aiPit,
  aiPitPhase,
  carStride,
  pitStateSize,
} from "../../apps/client/src/game/frame-layout.ts";
import {
  planWeekend,
  type WeekendPlan,
} from "../../apps/client/src/game/weekend.ts";
import { type SpeedDreams, startCircuit } from "./speed-dreams.ts";

const timingStride = 20;
const sessionFields = 12;
const statFields = 6;
const stepsPerCall = 20;
const secondsPerCall = stepsPerCall / 500;

export const sessionKind = { race: 1, qualifying: 2 } as const;
export const sessionPhase = { running: 0, complete: 2 } as const;
export const carStatus = {
  outLap: 1,
  flyingLap: 2,
  garage: 5,
  knockedOut: 8,
  queued: 9,
} as const;

export interface Weekend extends SpeedDreams {
  _free: (pointer: number) => void;
  _sdTyresConfigure: (compound: number, scale: number) => void;
  _sdEnergyConfigure: (
    race: number,
    mode: number,
    mix: number,
    assist: number,
  ) => void;
  _sdFieldClear: () => void;
  _sdFieldPlayer: (garage: number, seat: number, slot: number) => void;
  _sdFieldPlayerBox: () => number;
  _sdFieldPlan: (
    index: number,
    speed: number,
    raceSpeed: number,
    power: number,
  ) => void;
  _sdFieldStint: (index: number, compound: number, from: number) => void;
  _sdFieldAutopilot: (on: number) => void;
  _sdSessionConfigure: (
    kind: number,
    laps: number,
    difficulty: number,
    seed: number,
  ) => void;
  _sdSessionInfo: (out: number) => void;
  _sdSessionStats: (out: number) => void;
  _sdSessionAdvance: () => number;
  _sdSessionSimulate: () => void;
  _sdSessionPlayerRun: () => number;
  _sdSessionGrid: (out: number) => number;
  _sdQualifyingTimes: (index: number, out: number) => void;
  _sdTiming: (out: number) => void;
  _sdCars: (out: number) => void;
  _sdFieldPits: (out: number) => void;
  _sdSessionPasses: (out: number, max: number, from: number) => number;
  _sdRaceControlConfigure: (
    safetyCar: number,
    redFlags: number,
    rollingStart: number,
  ) => void;
  _sdRaceControlDeploy: (which: number) => number;
  _sdRaceControlInfo: (out: number) => void;
  _sdWeatherConfigure: (dynamic: number, seed: number) => void;
  _sdWeatherSet: (rain: number, line: number, off: number) => void;
  _sdWeatherInfo: (out: number) => void;
  FS: {
    readFile: (path: string, options: { encoding: "utf8" }) => string;
    writeFile: (path: string, data: string) => void;
  };
}

export function withStints(
  plan: WeekendPlan,
  stints: { compound: number; from: number }[][],
): WeekendPlan {
  return {
    ...plan,
    entrants: plan.entrants.map((entrant, i) => ({
      ...entrant,
      stints: stints[i] ?? [],
    })),
  };
}

export function subset(plan: WeekendPlan, cars: number): WeekendPlan {
  const kept = plan.entrants
    .map((_, index) => index)
    .sort((a, b) => (plan.slots[a] ?? 0) - (plan.slots[b] ?? 0))
    .slice(0, cars);
  return {
    entrants: kept.flatMap((i) => plan.entrants[i] ?? []),
    slots: kept.map((_, slot) => slot),
  };
}

export interface FieldOptions {
  kind: number;
  laps: number;
  seed: number;
  wear?: number;
  plan?: WeekendPlan;
  autopilot?: boolean;
  rules?: Rules;
  rain?: string;
  track?: string;
}

export interface Rules {
  safetyCar?: number;
  redFlags?: boolean;
  rollingStart?: boolean;
}

const raceFile = "/sd/local/config/raceman/quickrace.xml";

export async function startField(options: FieldOptions): Promise<Weekend> {
  const plan = options.plan ?? planWeekend("corvus", 10, null);
  const rules = options.rules ?? {};
  return startCircuit<Weekend>((m) => {
    m._sdRaceControlConfigure(
      rules.safetyCar ?? 2,
      rules.redFlags === false ? 0 : 1,
      rules.rollingStart ? 1 : 0,
    );
    m._sdTyresConfigure(1, options.wear ?? 1);
    m._sdEnergyConfigure(options.kind === sessionKind.race ? 1 : 0, 1, 1, 1);
    const add = m.cwrap("sdFieldAdd", "null", [
      "string",
      "string",
      "string",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]);
    m._sdFieldClear();
    plan.entrants.forEach((entrant, index) => {
      const slot = plan.slots[index] ?? index;
      if (entrant.player) m._sdFieldPlayer(entrant.garage, entrant.seat, slot);
      else
        add(
          entrant.name,
          entrant.code,
          entrant.team,
          entrant.garage,
          entrant.seat,
          slot,
          entrant.speed,
          entrant.raceSpeed,
          1,
        );
      m._sdFieldPlan(index, entrant.speed, entrant.raceSpeed, entrant.power);
      for (const stint of entrant.stints)
        m._sdFieldStint(index, stint.compound, stint.from);
    });
    m._sdSessionConfigure(options.kind, options.laps, 1, options.seed);
    if (options.autopilot ?? true) m._sdFieldAutopilot(1);
    if (options.rain)
      m.FS.writeFile(
        raceFile,
        m.FS.readFile(raceFile, { encoding: "utf8" }).replace(
          'name="rain" val="none"',
          `name="rain" val="${options.rain}"`,
        ),
      );
  }, options.track);
}

function read(
  m: Weekend,
  size: number,
  fill: (pointer: number) => void,
): Float64Array {
  const pointer = m._malloc(size * 8);
  fill(pointer);
  const values = new Float64Array(m.HEAPF64.buffer, pointer, size).slice();
  m._free(pointer);
  return values;
}

export function sessionOf(m: Weekend) {
  const v = read(m, sessionFields, (p) => {
    m._sdSessionInfo(p);
  });
  return {
    phase: v[1] ?? 0,
    segment: v[2] ?? 0,
    toRun: v[3] ?? 0,
    playerRun: v[10] ?? 0,
    onTrack: v[11] ?? -1,
  };
}

export function phaseOf(m: Weekend): number {
  return sessionOf(m).phase;
}

export function statsOf(m: Weekend) {
  const v = read(m, statFields, (p) => {
    m._sdSessionStats(p);
  });
  return {
    contacts: v[0] ?? 0,
    walls: v[2] ?? 0,
    overtakes: v[3] ?? 0,
    pits: v[5] ?? 0,
  };
}

export function passesOf(m: Weekend) {
  const fields = 5;
  const total = m._sdSessionPasses(0, 0, 0);
  const v = read(m, Math.max(1, total) * fields, (p) => {
    m._sdSessionPasses(p, total, 0);
  });
  return Array.from({ length: total }, (_, k) => ({
    time: v[k * fields] ?? 0,
    passer: v[k * fields + 1] ?? 0,
    passed: v[k * fields + 2] ?? 0,
    position: v[k * fields + 3] ?? 0,
  }));
}

export function timingOf(m: Weekend, cars: number) {
  const v = read(m, cars * timingStride, (p) => {
    m._sdTiming(p);
  });
  return Array.from({ length: cars }, (_, index) => {
    const field = (k: number) => v[index * timingStride + k] ?? 0;
    return {
      index,
      position: field(0),
      status: field(1),
      laps: field(2),
      best: field(3),
      lastLap: field(4),
      compound: field(8),
      pits: field(10),
      finished: field(12) === 1,
      retired: field(12) === 2,
      finishTime: field(13),
      segmentBest: field(11),
      eliminated: field(14) === 1,
    };
  });
}

export function carPoses(m: Weekend, cars: number) {
  const v = read(m, cars * carStride, (p) => {
    m._sdCars(p);
  });
  return Array.from({ length: cars }, (_, index) => {
    const at = (k: number) => v[index * carStride + k] ?? 0;
    return {
      x: at(12),
      y: at(13),
      headingX: at(0),
      headingY: at(1),
      frontAxle: Math.max(at(16), at(22)),
      speed: at(40),
      toMiddle: at(47),
      distance: at(48),
      compound: at(45),
    };
  });
}

export function carMotion(m: Weekend, cars: number) {
  const v = read(m, cars * carStride, (p) => {
    m._sdCars(p);
  });
  return Array.from({ length: cars }, (_, index) => ({
    speed: Math.abs(v[index * carStride + 40] ?? 0),
    steer: v[index * carStride + 41] ?? 0,
  }));
}

export function trackPoint(m: Weekend, distance: number, lateral: number) {
  const pointer = m._malloc(12);
  m._sdTrackLocal2Global(distance, lateral, pointer);
  const [x = 0, y = 0] = new Float32Array(m.HEAPF64.buffer, pointer, 2);
  m._free(pointer);
  return { x, y };
}

export function qualifyingTimes(m: Weekend, index: number): number[] {
  return Array.from(
    read(m, 3, (p) => {
      m._sdQualifyingTimes(index, p);
    }),
  );
}

export function gridOf(m: Weekend, cars: number): number[] {
  const pointer = m._malloc(cars * 4);
  const count = m._sdSessionGrid(pointer);
  const grid = Array.from(
    new Int32Array(m.HEAPF64.buffer, pointer, count).slice(),
  );
  m._free(pointer);
  return grid;
}

export function weatherOf(m: Weekend) {
  const v = read(m, 13, (p) => {
    m._sdWeatherInfo(p);
  });
  return {
    rain: v[0] ?? 0,
    line: v[1] ?? 0,
    off: v[2] ?? 0,
    player: v[3] ?? 0,
    clock: v[4] ?? 0,
    forecast: Array.from(v.slice(7, 13)),
  };
}

export interface BoxLines {
  released: number;
  wrongTyres: number;
  stops: number;
  arriving: number;
  parked: number;
  leaving: number;
}

interface BoxVisit {
  box: number;
  requested: number;
  released: boolean;
  wrongTyres: boolean;
  shared: boolean;
  parkedAt: number;
  arriving: number;
  parked: number;
  leaving: number;
}

const crewAhead = 6;
const crewBehind = 4.5;
const neighbourReach = 40;

export function watchBoxes(
  m: Weekend,
  cars: number,
  trackLength: number,
  boxLine: number,
  straightFrom: number,
): { lines: BoxLines; look: () => void } {
  const lines: BoxLines = {
    released: 0,
    wrongTyres: 0,
    stops: 0,
    arriving: 0,
    parked: 0,
    leaving: 0,
  };
  const visits = new Map<number, BoxVisit>();
  const ahead = (from: number, to: number) =>
    (((to - from) % trackLength) + trackLength) % trackLength;
  const apart = (a: number, b: number) => Math.min(ahead(a, b), ahead(b, a));
  const pitting = (phase: number) =>
    phase >= aiPitPhase.lane && phase <= aiPitPhase.release;
  const finish = (car: number) => {
    const visit = visits.get(car);
    visits.delete(car);
    if (visit?.released) lines.released += 1;
    if (visit?.wrongTyres) lines.wrongTyres += 1;
    if (!visit || visit.shared || visit.parked < 0) return;
    if (ahead(straightFrom, visit.box) > trackLength / 2) return;
    lines.stops += 1;
    lines.arriving = Math.max(lines.arriving, visit.arriving);
    lines.parked = Math.max(lines.parked, visit.parked);
    lines.leaving = Math.max(lines.leaving, visit.leaving);
  };
  const follow = (visit: BoxVisit, phase: number, box: number, car: number) => {
    const pose = carPoses(m, cars)[car];
    if (!pose) return;
    const off = Math.abs(pose.toMiddle - boxLine);
    if (phase === aiPitPhase.stopped) {
      visit.parked = Math.max(visit.parked, off);
      visit.parkedAt = pose.toMiddle;
    }
    if (phase === aiPitPhase.boxing && ahead(pose.distance, box) < crewAhead)
      visit.arriving = Math.max(visit.arriving, off);
    if (phase === aiPitPhase.release && !visit.released) {
      visit.released = true;
      visit.wrongTyres =
        visit.requested >= 0 && pose.compound !== visit.requested;
    }
    if (phase === aiPitPhase.release && ahead(box, pose.distance) < crewBehind)
      visit.leaving = Math.max(
        visit.leaving,
        Math.abs(pose.toMiddle - visit.parkedAt),
      );
  };
  const look = () => {
    const pits = read(m, cars * pitStateSize, (p) => {
      m._sdFieldPits(p);
    });
    const phase = (car: number) => pits[car * pitStateSize + aiPit.phase] ?? 0;
    const box = (car: number) => pits[car * pitStateSize + aiPit.box] ?? 0;
    for (let car = 1; car < cars; car++) {
      if (!pitting(phase(car))) {
        finish(car);
        continue;
      }
      const visit = visits.get(car) ?? {
        box: box(car),
        requested: -1,
        released: false,
        wrongTyres: false,
        shared: false,
        parkedAt: boxLine,
        arriving: 0,
        parked: -1,
        leaving: 0,
      };
      visits.set(car, visit);
      visit.requested = pits[car * pitStateSize + aiPit.compound] ?? -1;
      for (let other = 0; other < cars; other++)
        if (other !== car && pitting(phase(other)))
          visit.shared ||= apart(box(car), box(other)) < neighbourReach;
      follow(visit, phase(car), box(car), car);
    }
  };
  return { lines, look };
}

export function runUntilComplete(
  m: Weekend,
  limitSeconds: number,
  onSecond?: () => void,
  onCall?: () => void,
): void {
  const calls = limitSeconds / secondsPerCall;
  for (let call = 0; call < calls; call++) {
    m._sdStep(stepsPerCall);
    onCall?.();
    if (call % 25 !== 0) continue;
    onSecond?.();
    if (phaseOf(m) === sessionPhase.complete) return;
  }
}
