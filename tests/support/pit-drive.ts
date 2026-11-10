import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PitStop,
  steerCommand,
  type PitControl,
  type PitDrive,
  type PitLayout,
  type PitPenalty,
} from "../../apps/client/src/game/pitstop.ts";
import { type RaceSystems, statusReader } from "./race-systems.ts";
import { repoRoot } from "./repo.ts";

export function layoutOf(track: string): PitLayout {
  return (
    JSON.parse(
      readFileSync(
        path.join(repoRoot, `content/tracks/${track}/sd-frame.json`),
        "utf8",
      ),
    ) as { pit: PitLayout }
  ).pit;
}

export const layout = layoutOf("hill-country");

const noPenalty: PitPenalty = { kind: "none", seconds: 0 };

export interface PitOptions {
  track?: string;
  replaceWing?: boolean;
  penalty?: () => PitPenalty;
  settle?: number;
  driveOn?: number;
}

export interface Lap {
  phases: Set<string>;
  finished: boolean;
  parkedAlong: number;
  parkedLateral: number;
  fuelBefore: number;
  fuelAfter: number;
  startFuel: number;
  fastestInLane: number;
  stopTime: number;
  wingBefore: number;
  wingAfter: number;
  floorAfter: number;
}

const aheadOn = (pit: PitLayout, from: number, to: number) =>
  (((to - from) % pit.length) + pit.length) % pit.length;

function approach(
  pit: PitLayout,
  armed: boolean,
  distance: number,
  look: number,
): PitDrive {
  const fromEntry = aheadOn(pit, pit.entry - 30, distance + look);
  const entering =
    armed && fromEntry < aheadOn(pit, pit.entry - 30, pit.wallEnd);
  return {
    lateral: entering ? Math.min(pit.fastLane, fromEntry * 0.14) : 0,
    lookahead: look,
    speed: 22,
  };
}

function sample(m: RaceSystems) {
  const frame = new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
  const [time, cos, sin] = [frame[0], frame[1], frame[2]].map((v) => v ?? 0);
  const [x, y] = [frame[13], frame[14]].map((v) => v ?? 0);
  const [speed, distance, toMiddle] = [frame[45], frame[53], frame[54]].map(
    (v) => v ?? 0,
  );
  return {
    time: time ?? 0,
    heading: Math.atan2(sin ?? 0, cos ?? 1),
    x: x ?? 0,
    y: y ?? 0,
    speed: Math.abs(speed ?? 0),
    distance: distance ?? 0,
    toMiddle: toMiddle ?? 0,
  };
}

function record(
  pit: PitLayout,
  lap: Lap,
  control: PitControl,
  car: ReturnType<typeof sample>,
  lateral: number,
  fuel: number,
): void {
  if (control.phase === "service" && !lap.phases.has("service")) {
    lap.parkedAlong = aheadOn(pit, car.distance, pit.boxDistance);
    lap.parkedLateral = lateral;
    lap.fuelBefore = fuel;
  }
  lap.phases.add(control.phase);
  if (control.limit > 0 && control.phase === "lane")
    lap.fastestInLane = Math.max(lap.fastestInLane, car.speed * 3.6);
  lap.finished = lap.phases.has("release") && control.phase === "lane";
}

function service(m: RaceSystems, lap: Lap, control: PitControl): void {
  m._sdPitService(lap.startFuel, control.wingChange ? 1 : 0);
  m._sdStep(1);
  lap.stopTime = control.stopTime ?? 0;
}

interface StopRun {
  layout: PitLayout;
  m: RaceSystems;
  pit: PitStop;
  lap: Lap;
  point: (d: number, l: number) => number[];
  fuel: () => number;
  status: ReturnType<typeof statusReader>;
  armed: boolean;
}

function stepStop(run: StopRun): void {
  const { m, pit, lap, layout: plan } = run;
  const car = sample(m);
  run.armed ||= car.distance > 1000 && car.distance < 5000;
  const toTurn = aheadOn(plan, car.distance, plan.boxDistance - 34);
  const control = pit.update(
    car,
    car.time,
    run.armed && toTurn / Math.max(car.speed, 1) < 0.04,
  );
  m._sdInputSpeedLimit(control.limit);
  m._sdInputPitHold(control.hold ? 1 : 0);
  const target =
    control.drive ??
    approach(plan, run.armed, car.distance, Math.max(8, car.speed * 0.45));
  const reach = car.distance + target.lookahead;
  const command = steerCommand(
    car,
    run.point(reach, target.lateral - pit.shiftAt(reach)),
    target.speed,
  );
  m._sdInputAnalog(1, command.steer, command.throttle, command.brake);
  record(
    plan,
    lap,
    control,
    car,
    car.toMiddle + pit.shiftAt(car.distance),
    run.fuel(),
  );
  if (control.serviceNow) {
    service(m, lap, control);
    lap.fuelAfter = run.fuel();
    lap.wingAfter = run.status().part(0);
    lap.floorAfter = run.status().part(4);
  }
  m._sdStep(1);
}

function freshLap(startFuel: number): Lap {
  return {
    phases: new Set(),
    finished: false,
    parkedAlong: 99,
    parkedLateral: 0,
    fuelBefore: 0,
    fuelAfter: 0,
    startFuel,
    fastestInLane: 0,
    stopTime: 0,
    wingBefore: 0.6,
    wingAfter: 0,
    floorAfter: 0,
  };
}

function planOf(options: PitOptions): PitLayout {
  return layoutOf(options.track ?? "hill-country");
}

export function driveStop(m: RaceSystems, options: PitOptions = {}): Lap {
  const out = m._malloc(12);
  const hud = m._malloc(8 * 32);
  const point = (d: number, l: number) => {
    m._sdTrackLocal2Global(d, l, out);
    return Array.from(new Float32Array(m.HEAPF32.buffer, out, 3));
  };
  const fuel = () => {
    m._sdHudInfo(hud);
    return new Float64Array(m.HEAPF64.buffer, hud, 32)[0] ?? 0;
  };
  const plan = planOf(options);
  const pit = new PitStop(plan, false);
  pit.requestWing(options.replaceWing ?? false);
  m._sdInputSteerDirect(1);
  m._sdStep(options.settle ?? 1000);
  const lap = freshLap(fuel());
  m._sdCarDamageSet(0, lap.wingBefore);
  m._sdCarDamageSet(4, 0.5);
  const run: StopRun = {
    layout: plan,
    m,
    pit,
    lap,
    point,
    fuel,
    status: statusReader(m),
    armed: false,
  };
  const driveOn = options.driveOn ?? 0;
  const penalty = options.penalty ?? (() => noPenalty);
  let after = 0;
  for (let tick = 0; tick < 200000; tick++) {
    if (after > 0 || lap.finished) after++;
    if (after > driveOn) break;
    pit.setPenalty(penalty());
    stepStop(run);
  }
  return lap;
}
