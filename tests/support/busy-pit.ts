import {
  PitStop,
  pitReport,
  steerCommand,
  type PitControl,
  type PitDrive,
} from "../../apps/client/src/game/pitstop.ts";
import { aiPitPhase } from "../../apps/client/src/game/frame-layout.ts";
import { layoutOf } from "./pit-drive.ts";
import {
  carPoses,
  pitPhasesOf,
  runUntilComplete,
  sessionKind,
  startField,
  type Weekend,
} from "./race-weekend.ts";

interface PitPlayer extends Weekend {
  _sdAiPlayerLaneClear: () => number;
  _sdAiPlayerBoxTaken: () => number;
  _sdAiPlayerSideBlocked: () => number;
  _sdAiPlayerPit: (phase: number, serviceLeft: number) => void;
}

export interface BusyStop {
  aiInLane: number;
  serviced: boolean;
  held: number;
  playerContacts: number;
  playerTouches: number;
  aiTouches: number;
  stacked: number;
  passedRelease: number;
  rejoined: boolean;
}

type Pose = ReturnType<typeof carPoses>[number];

const cars = 22;
const rainAt = 150;
const takeOverAfter = 195;
const takeOverFrom = 300;
const takeOverTo = 250;
const laneSpeed = 22;
const trackSpeed = 70;
const approachDecel = 10;
const followDecel = 7;
const followGap = 7;
const followReach = 60;
const followWidth = 2.4;
const bodyLength = 5.4;
const bodyWidth = 1.95;
const stackFrom = 5;
const stackTo = 15;
const stackSpeed = 0.3;
const exitRun = 50;
const passReach = 30;
const drySeconds = 90;
const rushSeconds = 420;
const callSeconds = 0.04;
const soaked = 0.7;
const stepLimit = 120_000;
const plan = layoutOf("hill-country");

const ahead = (from: number, to: number) =>
  (((to - from) % plan.length) + plan.length) % plan.length;

function frameOf(m: Weekend) {
  const f = new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
  const at = (k: number) => f[k] ?? 0;
  return {
    time: at(0),
    heading: Math.atan2(at(2), at(1)),
    x: at(13),
    y: at(14),
    speed: Math.abs(at(45)),
    distance: at(53),
    toMiddle: at(54),
  };
}

function playerContacts(m: Weekend): number {
  const pointer = m._malloc(8 * 8);
  m._sdSessionStats(pointer);
  const value = new Float64Array(m.HEAPF64.buffer, pointer, 7)[1] ?? 0;
  m._free(pointer);
  return value;
}

function local(from: Pose, to: Pose) {
  const size = Math.hypot(from.headingX, from.headingY) || 1;
  const hx = from.headingX / size;
  const hy = from.headingY / size;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return { along: dx * hx + dy * hy, across: -dx * hy + dy * hx };
}

function touching(a: Pose, b: Pose): boolean {
  const { along, across } = local(a, b);
  return Math.abs(along) < bodyLength && Math.abs(across) < bodyWidth;
}

async function raceToPitEntry(seed: number): Promise<PitPlayer> {
  const m = (await startField({
    kind: sessionKind.race,
    laps: 8,
    seed,
    weather: { story: "rain", start: 0, shifts: [{ at: rainAt, level: 2 }] },
  })) as PitPlayer;
  for (let step = 0; step < 400_000; step++) {
    m._sdStep(1);
    const car = frameOf(m);
    const toEntry = ahead(car.distance, plan.entry);
    const ready =
      car.time > takeOverAfter && (pitPhasesOf(m, cars)[0] ?? 0) === 0;
    if (ready && toEntry < takeOverFrom && toEntry > takeOverTo) break;
  }
  m._sdFieldAutopilot(0);
  m._sdInputSteerDirect(1);
  return m;
}

function followCap(poses: Pose[], speed: number): number {
  const me = poses[0];
  if (!me) return speed;
  let cap = speed;
  for (const other of poses.slice(1)) {
    const { along, across } = local(me, other);
    if (along <= 0 || along > followReach || Math.abs(across) > followWidth)
      continue;
    const room = Math.max(0, along - followGap);
    cap = Math.min(
      cap,
      Math.sqrt(2 * followDecel * room) + Math.max(0, other.speed),
    );
  }
  return cap;
}

function laneDrive(
  control: PitControl,
  car: ReturnType<typeof frameOf>,
  poses: Pose[],
): PitDrive {
  const look = Math.max(8, car.speed * 0.45);
  const fromEntry = ahead(plan.entry - 30, car.distance + look);
  const inLane =
    control.phase !== "track" ||
    fromEntry < ahead(plan.entry - 30, plan.wallEnd);
  const toEntry = ahead(car.distance, plan.entry);
  const braking = Math.sqrt(
    laneSpeed ** 2 + 2 * approachDecel * Math.max(0, toEntry - 40),
  );
  const speed =
    control.phase === "track" ? Math.min(trackSpeed, braking) : laneSpeed;
  return {
    lateral: inLane ? Math.min(plan.fastLane, fromEntry * 0.14) : 0,
    lookahead: look,
    speed: control.phase === "track" ? speed : followCap(poses, speed),
  };
}

interface Watch {
  stop: BusyStop;
  touching: Set<string>;
  phase: string;
  doneAt: number | null;
  wasAhead: Map<number, boolean>;
  aiSeen: Set<number>;
  stackSeen: Set<number>;
}

function pitPair(a: number, b: number, phases: number[]): boolean {
  const pitting = (i: number) => (phases[i] ?? 0) >= aiPitPhase.lane;
  return a === 0 || pitting(a) || pitting(b);
}

function watchPair(watch: Watch, poses: Pose[], a: number, b: number): void {
  const pa = poses[a];
  const pb = poses[b];
  const key = `${String(a)}-${String(b)}`;
  if (!pa || !pb || !touching(pa, pb)) {
    watch.touching.delete(key);
    return;
  }
  if (watch.touching.has(key)) return;
  watch.touching.add(key);
  if (a === 0) watch.stop.playerTouches++;
  else watch.stop.aiTouches++;
}

function watchTouches(watch: Watch, poses: Pose[], phases: number[]): void {
  for (let a = 0; a < poses.length; a++)
    for (let b = a + 1; b < poses.length; b++)
      if (pitPair(a, b, phases)) watchPair(watch, poses, a, b);
      else watch.touching.delete(`${String(a)}-${String(b)}`);
}

function watchRelease(watch: Watch, poses: Pose[]): void {
  const me = poses[0];
  if (!me || watch.phase !== "release") return;
  poses.forEach((other, i) => {
    if (i === 0) return;
    const gap = ahead(me.distance, other.distance);
    const past = gap < passReach;
    const behind = plan.length - gap < passReach;
    if (watch.wasAhead.get(i) === false && past) watch.stop.passedRelease++;
    if (past || behind) watch.wasAhead.set(i, past);
  });
}

function watchField(
  watch: Watch,
  m: Weekend,
  poses: Pose[],
  boxes: number[],
): void {
  const phases = pitPhasesOf(m, cars);
  phases.forEach((phase, i) => {
    if (i > 0 && phase >= aiPitPhase.lane) watch.aiSeen.add(i);
    const pose = poses[i];
    const box = boxes[i] ?? 0;
    if (i === 0 || phase !== aiPitPhase.boxing || !pose) return;
    const toBox = ahead(pose.distance, box);
    const waiting = Math.abs(pose.speed) < stackSpeed;
    if (waiting && toBox > stackFrom && toBox < stackTo) watch.stackSeen.add(i);
  });
  watchTouches(watch, poses, phases);
}

function pitBoxes(m: Weekend): number[] {
  const size = 7;
  const pointer = m._malloc(cars * size * 8);
  m._sdFieldPits(pointer);
  const pits = new Float64Array(m.HEAPF64.buffer, pointer, cars * size);
  const boxes = Array.from({ length: cars }, (_, i) => pits[i * size + 3] ?? 0);
  m._free(pointer);
  return boxes;
}

function note(watch: Watch, control: PitControl): void {
  if (control.phase === watch.phase) return;
  if (control.phase === "service") watch.stop.serviced = true;
  if (control.phase === "release" && watch.doneAt !== null)
    watch.stop.held = Math.max(0, (control.stopTime ?? 0) - watch.doneAt);
  watch.phase = control.phase;
}

export async function busyPitStop(seed: number): Promise<BusyStop> {
  const m = await raceToPitEntry(seed);
  const box = m._sdFieldPlayerBox();
  const pit = new PitStop({ ...plan, boxDistance: box }, false, () => 0.5);
  const out = m._malloc(12);
  const point = (d: number, l: number) => {
    m._sdTrackLocal2Global(d, l, out);
    return Array.from(new Float32Array(m.HEAPF32.buffer, out, 3));
  };
  const contactsBefore = playerContacts(m);
  const watch: Watch = {
    stop: {
      aiInLane: 0,
      serviced: false,
      held: 0,
      playerContacts: 0,
      playerTouches: 0,
      aiTouches: 0,
      stacked: 0,
      passedRelease: 0,
      rejoined: false,
    },
    touching: new Set(),
    phase: "track",
    doneAt: null,
    wasAhead: new Map(),
    aiSeen: new Set(),
    stackSeen: new Set(),
  };
  for (let step = 0; step < stepLimit && !watch.stop.rejoined; step++) {
    const car = frameOf(m);
    const toTurn = ahead(car.distance, box - 34);
    const control = pit.update(
      {
        ...car,
        laneClear: m._sdAiPlayerLaneClear() === 1,
        boxTaken: m._sdAiPlayerBoxTaken() === 1,
        sideBlocked: m._sdAiPlayerSideBlocked() === 1,
      },
      car.time,
      toTurn / Math.max(car.speed, 1) < 0.04,
    );
    m._sdAiPlayerPit(...pitReport(control));
    m._sdInputSpeedLimit(control.limit);
    m._sdInputPitHold(control.hold ? 1 : 0);
    if (control.phase === "service" && control.plan)
      watch.doneAt = control.plan.duration;
    note(watch, control);
    if (control.serviceNow) m._sdPitService(100, 0);
    const poses = carPoses(m, cars);
    const target = control.drive ?? laneDrive(control, car, poses);
    const reach = car.distance + target.lookahead;
    const command = steerCommand(
      car,
      point(reach, target.lateral - pit.shiftAt(reach)),
      target.speed,
    );
    m._sdInputAnalog(1, command.steer, command.throttle, command.brake);
    if (step % 10 === 0) {
      watchField(watch, m, poses, pitBoxes(m));
      watchRelease(watch, poses);
    }
    watch.stop.rejoined =
      watch.stop.serviced && ahead(plan.exit, car.distance) < exitRun;
    m._sdStep(1);
  }
  watch.stop.playerContacts = playerContacts(m) - contactsBefore;
  watch.stop.aiInLane = watch.aiSeen.size;
  watch.stop.stacked = watch.stackSeen.size;
  return watch.stop;
}

export async function wetRush(seed: number): Promise<{
  stops: number;
  longest: number;
}> {
  const m = await startField({ kind: sessionKind.race, laps: 10, seed });
  runUntilComplete(m, drySeconds);
  m._sdWeatherSet(1, soaked, soaked);
  const entered = new Array<number>(cars).fill(-1);
  const stops: number[] = [];
  let clock = 0;
  runUntilComplete(m, rushSeconds, undefined, () => {
    clock += callSeconds;
    pitPhasesOf(m, cars).forEach((phase, car) => {
      const inLane = phase >= aiPitPhase.lane;
      const was = entered[car] ?? -1;
      if (inLane && was < 0) entered[car] = clock;
      if (!inLane && was >= 0) {
        stops.push(clock - was);
        entered[car] = -1;
      }
    });
  });
  const open = entered.filter((at) => at >= 0).map((at) => clock - at);
  return { stops: stops.length, longest: Math.max(0, ...stops, ...open) };
}
