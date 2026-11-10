export interface CornerPlan {
  gunOn: number;
  nutOff: number;
  tyreOff: number;
  tyreOn: number;
  nutOn: number;
  done: number;
  retries: number[];
}

export interface WingPlan {
  unlock: number;
  off: number;
  fit: number;
  done: number;
}

export interface StopPlan {
  duration: number;
  hold: number;
  settle: number;
  service: boolean;
  corners: CornerPlan[];
  frontUp: number;
  rearUp: number;
  frontDown: number;
  rearDown: number;
  release: number;
  wing: WingPlan | null;
}

export interface StopRequest {
  timingError: number;
  frontWing: boolean;
  hold: number;
  service: boolean;
  random: () => number;
}

const stopCurve: [number, number][] = [
  [0, 1.92],
  [0.05, 1.98],
  [0.12, 2.2],
  [0.35, 2.75],
  [0.6, 3.6],
  [1, 5],
  [1.5, 7],
];
export const missedTurnIn = 0.8;
const fastestStop = 1.85;
export const longestStop = 10;
const variation = 0.08;
const wingWork = 5.4;
const reaction = 0.22;
const lightLead = 0.04;
const jackDrop = 0.16;
const jackGap = 0.08;
const frontLift = 0.16;
const rearLift = 0.3;
const gunReach = 0.12;
const loosen = 0.24;
const pullOff = 0.24;
const fitOn = 0.28;
const tighten = 0.3;
const handUp = 0.1;
const cornerJitter = 0.12;
const settleShare = 0.6;
const longestSettle = 1.2;
const sharedSlowShare = 0.4;
const longestSharedSlow = 0.4;
const retrySpacing = 1.1;
const wingUnlock = 0.2;
const wingPull = 0.75;
const wingBring = 4.1;
const wingFit = 0.8;
const timedError = 0.2;

function along(curve: [number, number][], x: number): number {
  const first = curve[0] ?? [0, 0];
  if (x <= first[0]) return first[1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i] ?? first;
    const [x0, y0] = curve[i - 1] ?? first;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return curve.at(-1)?.[1] ?? first[1];
}

export function stopSeconds(
  timingError: number,
  frontWing: boolean,
  luck: number,
): number {
  const base = along(stopCurve, Math.abs(timingError));
  const varied = Math.max(fastestStop, base + (luck * 2 - 1) * variation);
  return Math.min(longestStop, varied + (frontWing ? wingWork : 0));
}

function corner(start: number, stretch: number): CornerPlan {
  const gunOn = start + gunReach;
  const nutOff = gunOn + loosen * stretch;
  const tyreOff = nutOff + pullOff * stretch;
  const tyreOn = tyreOff + fitOn * stretch;
  const nutOn = tyreOn + tighten * stretch;
  return {
    gunOn,
    nutOff,
    tyreOff,
    tyreOn,
    nutOn,
    done: nutOn + handUp,
    retries: [],
  };
}

function struggle(plan: CornerPlan, extra: number): void {
  if (extra <= 0) return;
  const count = Math.floor(extra / retrySpacing);
  for (let k = 1; k <= count; k++)
    plan.retries.push(plan.nutOn + (extra * k) / (count + 1));
  plan.nutOn += extra;
  plan.done += extra;
}

function tail(lastDone: number): number {
  return lastDone + jackGap + jackDrop + lightLead + reaction;
}

function waitOnly(hold: number): StopPlan {
  const release = hold - reaction;
  return {
    duration: hold,
    hold,
    settle: 0,
    service: false,
    corners: [],
    frontUp: Infinity,
    rearUp: Infinity,
    frontDown: Infinity,
    rearDown: Infinity,
    release,
    wing: null,
  };
}

export function planStop(request: StopRequest): StopPlan {
  if (!request.service) return waitOnly(request.hold);
  const { timingError, frontWing, random } = request;
  return shapeStop(stopSeconds(timingError, frontWing, random()), request);
}

export function planTimed(work: number, random: () => number): StopPlan {
  const clamped = Math.min(longestStop, Math.max(fastestStop, work));
  return shapeStop(clamped, {
    timingError: timedError,
    frontWing: false,
    hold: 0,
    service: true,
    random,
  });
}

function shapeStop(work: number, request: StopRequest): StopPlan {
  const { timingError, frontWing, hold, random } = request;
  const jitters = [0, 1, 2, 3].map(() => random() * cornerJitter);
  const clean = tail(corner(0, 1).done + Math.max(...jitters));
  const extra = Math.max(0, (frontWing ? work - wingWork : work) - clean);
  const share = Math.min(settleShare, Math.abs(timingError));
  const settle = Math.min(longestSettle, extra * share);
  const slow = Math.min(longestSharedSlow, (extra - settle) * sharedSlowShare);
  const stretch = 1 + slow / (loosen + pullOff + fitOn + tighten);
  const start = hold + settle;
  const corners = jitters.map((jitter) => corner(start + jitter, stretch));
  const lastBefore = Math.max(...corners.map((c) => c.done));
  const latest = corners.find((c) => c.done === lastBefore) ?? corners[0];
  const end = hold + work;
  const wing = frontWing ? wingPlan(start, end) : null;
  if (latest && !wing) struggle(latest, Math.max(0, end - tail(lastBefore)));
  const lastDone = Math.max(
    ...corners.map((c) => c.done),
    wing ? wing.done : 0,
  );
  const frontDown = lastDone + jackGap;
  const release = frontDown + jackDrop + lightLead;
  return {
    duration: release + reaction,
    hold,
    settle,
    service: true,
    corners,
    frontUp: start,
    rearUp: start + (rearLift - frontLift),
    frontDown,
    rearDown: frontDown,
    release,
    wing,
  };
}

function wingPlan(start: number, end: number): WingPlan {
  const done = end - (jackGap + jackDrop + lightLead + reaction);
  const unlock = start + wingUnlock;
  const off = unlock + wingPull;
  const fit = Math.max(off + wingBring, done - wingFit);
  return { unlock, off, fit, done };
}

export const liftTimes = { front: frontLift, rear: rearLift, drop: jackDrop };
