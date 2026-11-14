import {
  missedTurnIn,
  planStop,
  stopSeconds,
  type StopPlan,
} from "./pit-service.ts";

export interface PitLayout {
  length: number;
  entry: number;
  wallStart: number;
  wallEnd: number;
  exit: number;
  pitWall: number;
  shift: number;
  ramp: number;
  fastLane: number;
  speedLimit: number;
  boxDistance: number;
  boxLateral: number;
}

export type PitPhase = "track" | "lane" | "boxing" | "service" | "release";
type PitPenaltyKind = "none" | "time" | "drive-through" | "stop-go";

export interface PitPenalty {
  kind: PitPenaltyKind;
  seconds: number;
}
export type TurnInGrade = "optimal" | "good" | "early" | "late";

export interface PitCarState {
  distance: number;
  toMiddle: number;
  speed: number;
  laneClear?: boolean;
  boxTaken?: boolean;
  sideBlocked?: boolean;
}

export interface PitDrive {
  lateral: number;
  lookahead: number;
  speed: number;
}

export interface PitControl {
  phase: PitPhase;
  limit: number;
  hold: boolean;
  drive: PitDrive | null;
  serviceNow: boolean;
  serviceProgress: number;
  serviceTime: number;
  plan: StopPlan | null;
  countdown: number | null;
  grade: TurnInGrade | null;
  pitTime: number | null;
  stopTime: number | null;
  estimate: [number, number] | null;
  wingChange: boolean;
  choosingTyres: boolean;
  distanceToBox: number | null;
  queued: boolean;
  speedKph: number;
  penalty: PitPenalty;
  penaltyLeft: number | null;
}

const stopGoSeconds = 10;
const stackGap = 9;
const waiting = 1e9;
const report = {
  track: 0,
  entering: 1,
  boxing: 2,
  queued: 3,
  service: 4,
  release: 5,
  leaving: 6,
} as const;
const noPenalty: PitPenalty = { kind: "none", seconds: 0 };
const turnInLead = 34;
const countdownShown = 3.5;
const optimalWindow = 0.12;
const goodWindow = 0.35;
const latestPress = -0.35;
const stopDecel = 7;
const arrivalDistance = 0.5;
const creepSpeed = 1.2;
const creepDistance = 1.5;
const stoppedSpeed = 0.15;
const markShift = 0.35;
const markShiftLimit = 0.4;
const autoError = 0.1;
const releaseRun = 12;
const releaseStraight = 4.4;
const releaseLook = 3;
const releaseLookTime = 0.45;
const releaseSettle = 20;
const releaseDone = 0.5;
const lanePad = 0.2;
const escapeMargin = 1.5;
const entryClear = 15;
const minimumLook = 6;
const lookTime = 0.45;
const wheelbase = 3.5;
const steerLock = (30 * Math.PI) / 180;
const throttleGain = 0.5;
const brakeGain = 0.35;
const brakeFloor = 1.2;

export function gradeTurnIn(secondsEarly: number): TurnInGrade {
  const size = Math.abs(secondsEarly);
  if (size <= optimalWindow) return "optimal";
  if (size <= goodWindow) return "good";
  return secondsEarly > 0 ? "early" : "late";
}

function penaltyHold(penalty: PitPenalty): number {
  if (penalty.kind === "stop-go") return stopGoSeconds;
  return penalty.kind === "time" ? penalty.seconds : 0;
}

function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export class PitStop {
  private phase: PitPhase = "track";
  private grade: TurnInGrade | null = null;
  private turnError = 0;
  private stopping = false;
  private queued = false;
  private plan: StopPlan | null = null;
  private turnStart = 0;
  private turnLateral = 0;
  private serviceAt = 0;
  private serviced = false;
  private stopTime: number | null = null;
  private laneAt: number | null = null;
  private releaseAt = 0;
  private garageMode = false;
  private waiting = false;
  private garageReleased = false;
  private wingRequest = false;
  private wingChange = false;
  private owed: PitPenalty = noPenalty;
  private serving: PitPenalty = noPenalty;
  private last: number | null = null;

  constructor(
    private readonly layout: PitLayout,
    private readonly autoTurnIn: boolean,
    private readonly random: () => number = Math.random,
  ) {}

  startInGarage(): void {
    this.garageMode = true;
    this.waiting = true;
    this.phase = "service";
    this.grade = "optimal";
    this.serviceAt = Infinity;
    this.serviced = false;
  }

  useGarage(): void {
    this.garageMode = true;
  }

  get atGarage(): boolean {
    return this.waiting;
  }

  goToTrack(): void {
    this.garageReleased = true;
  }

  private ahead(from: number, to: number): number {
    const { length } = this.layout;
    return (((to - from) % length) + length) % length;
  }

  private onArc(distance: number, from: number, to: number): boolean {
    return this.ahead(from, distance) <= this.ahead(from, to);
  }

  requestWing(on: boolean): void {
    this.wingRequest = on;
  }

  setPenalty(penalty: PitPenalty): void {
    this.owed = penalty;
  }

  shiftAt(distance: number): number {
    const { wallStart, wallEnd, shift, ramp } = this.layout;
    if (this.onArc(distance, wallStart, wallEnd)) return shift;
    const before = this.ahead(distance, wallStart);
    const after = this.ahead(wallEnd, distance);
    return shift * ease(Math.max(1 - before / ramp, 1 - after / ramp, 0));
  }

  private inLane(car: PitCarState): boolean {
    const { entry, wallStart, ramp, pitWall } = this.layout;
    if (!this.onArc(car.distance, entry + entryClear, wallStart + ramp))
      return false;
    return car.toMiddle + this.shiftAt(car.distance) > pitWall + lanePad;
  }

  private leftLane(car: PitCarState): boolean {
    const lateral = car.toMiddle + this.shiftAt(car.distance);
    return lateral < this.layout.pitWall - escapeMargin;
  }

  private movedForward(distance: number): boolean {
    const from = this.last;
    this.last = distance;
    if (from === null) return true;
    const moved = this.ahead(from, distance);
    return moved > 0 && moved < this.layout.length / 2;
  }

  private updateLane(car: PitCarState, pressed: boolean): number | null {
    const { length, boxDistance } = this.layout;
    const toTurn = this.ahead(car.distance, boxDistance - turnInLead);
    const distance = toTurn > length / 2 ? toTurn - length : toTurn;
    const seconds = distance / Math.max(car.speed, 1);
    if (seconds >= countdownShown || this.serving.kind === "drive-through")
      return null;
    if (pressed || (this.autoTurnIn && seconds <= 0) || seconds < latestPress) {
      this.turnError = this.autoTurnIn
        ? (this.random() - 0.5) * autoError
        : pressed
          ? seconds
          : -missedTurnIn;
      this.grade = gradeTurnIn(this.turnError);
      this.stopping = false;
      this.phase = "boxing";
      this.turnStart = car.distance;
      this.turnLateral = car.toMiddle + this.shiftAt(car.distance);
    }
    return Math.max(0, seconds);
  }

  get stopMark(): number {
    const shift = Math.max(
      -markShiftLimit,
      Math.min(markShiftLimit, -this.turnError * markShift),
    );
    return this.layout.boxDistance + shift;
  }

  private arrived(car: PitCarState, toBox: number): boolean {
    const crawling = toBox < creepDistance && car.speed < creepSpeed;
    return (
      toBox > this.layout.length / 2 || toBox < arrivalDistance || crawling
    );
  }

  private holdTurn(car: PitCarState, look: number): void {
    this.turnLateral = car.toMiddle + this.shiftAt(car.distance);
    this.turnStart = car.distance + look;
  }

  private beginService(now: number): void {
    this.phase = "service";
    this.stopping = false;
    this.serviceAt = now;
    this.wingChange = this.wingRequest && this.serving.kind !== "stop-go";
    this.plan = planStop({
      timingError: this.turnError,
      frontWing: this.wingChange,
      hold: penaltyHold(this.serving),
      service: this.serving.kind !== "stop-go",
      random: this.random,
    });
  }

  private updateBoxing(
    car: PitCarState,
    look: number,
    now: number,
  ): PitDrive | null {
    const { boxLateral, speedLimit } = this.layout;
    const taken = car.boxTaken === true;
    if (this.queued && !taken) this.stopping = this.queued = false;
    const toBox = this.ahead(
      car.distance,
      this.stopMark - (taken ? stackGap : 0),
    );
    if (car.sideBlocked === true && !this.stopping) this.holdTurn(car, look);
    const run = Math.max(1, this.ahead(this.turnStart, this.stopMark) - 8);
    const blend = ease(this.ahead(this.turnStart, car.distance + look) / run);
    if (this.arrived(car, toBox)) this.stopping = true;
    if (this.stopping) {
      this.queued = taken;
      if (!taken && car.speed < stoppedSpeed) this.beginService(now);
      return null;
    }
    return {
      lateral: this.turnLateral + (boxLateral - this.turnLateral) * blend,
      lookahead: look,
      speed: Math.min(speedLimit / 3.6, Math.sqrt(2 * stopDecel * toBox) + 0.5),
    };
  }

  private updateGarage(car: PitCarState): number {
    this.plan = null;
    this.waiting = true;
    if (!this.garageReleased || car.laneClear === false) return 0;
    this.garageReleased = false;
    this.waiting = false;
    this.serviced = true;
    this.phase = "release";
    this.releaseAt = car.distance;
    return 1;
  }

  private updateService(car: PitCarState, now: number): number {
    if (this.garageMode) return this.updateGarage(car);
    const duration = this.plan?.duration ?? 0;
    const elapsed = now - this.serviceAt;
    if (elapsed >= duration && car.laneClear !== false) {
      this.stopTime = elapsed;
      this.serviced = true;
      this.phase = "release";
      this.releaseAt = car.distance;
    }
    return Math.min(1, elapsed / duration);
  }

  private updateRelease(car: PitCarState): PitDrive | null {
    const { boxLateral, fastLane, speedLimit } = this.layout;
    const look = Math.max(releaseLook, car.speed * releaseLookTime);
    const reached = this.ahead(this.releaseAt, car.distance + look);
    const blend = ease((reached - releaseStraight) / releaseRun);
    const lateral = car.toMiddle + this.shiftAt(car.distance);
    const settled =
      this.ahead(this.releaseAt, car.distance) > releaseRun + releaseSettle;
    if (settled && Math.abs(lateral - fastLane) < releaseDone) {
      this.phase = "lane";
      return null;
    }
    return {
      lateral: boxLateral + (fastLane - boxLateral) * blend,
      lookahead: look,
      speed: speedLimit / 3.6,
    };
  }

  private inLimiter(car: PitCarState): boolean {
    const { entry, wallEnd } = this.layout;
    if (this.phase === "track") return false;
    return this.phase !== "lane" || this.onArc(car.distance, entry, wallEnd);
  }

  private boxRemaining(car: PitCarState): number | null {
    if (this.phase === "track" || this.serviced) return null;
    const toBox = this.ahead(car.distance, this.layout.boxDistance);
    return toBox < this.layout.length / 2 ? toBox : null;
  }

  private startTimer(car: PitCarState, now: number): void {
    const { wallStart, wallEnd } = this.layout;
    const crossed = this.onArc(car.distance, wallStart, wallEnd);
    if (this.laneAt === null && this.phase !== "track" && crossed)
      this.laneAt = now;
  }

  private advance(car: PitCarState, now: number, pressed: boolean) {
    const look = Math.max(minimumLook, car.speed * lookTime);
    let countdown: number | null = null;
    let drive: PitDrive | null = null;
    let serviceProgress = 0;
    this.enterLane(car);
    if (this.phase === "lane" && !this.serviced)
      countdown = this.updateLane(car, pressed);
    if (this.phase === "boxing") drive = this.updateBoxing(car, look, now);
    const inService = this.phase === "service";
    if (inService) {
      drive = null;
      serviceProgress = this.updateService(car, now);
    }
    const hold = this.holding();
    const serviceNow = inService && !hold && this.serving.kind !== "stop-go";
    if (this.phase === "release") drive = this.updateRelease(car);
    return { countdown, drive, serviceProgress, hold, serviceNow };
  }

  private enterLane(car: PitCarState): void {
    const forward = this.movedForward(car.distance);
    if (this.phase !== "track" || !forward || !this.inLane(car)) return;
    this.phase = "lane";
    this.serving = this.owed;
  }

  private holding(): boolean {
    return (
      this.phase === "service" || (this.phase === "boxing" && this.stopping)
    );
  }

  private shownPlan(): StopPlan | null {
    return this.phase === "track" || this.garageMode ? null : this.plan;
  }

  private penaltyLeft(now: number): number | null {
    const hold = penaltyHold(this.serving);
    if (this.phase !== "service" || this.garageMode || hold <= 0) return null;
    return Math.max(0, hold - (now - this.serviceAt));
  }

  private estimate(): [number, number] | null {
    if (!this.grade) return null;
    if (this.plan && this.phase !== "boxing")
      return [this.plan.duration, this.plan.duration];
    if (this.serving.kind === "stop-go") return [stopGoSeconds, stopGoSeconds];
    const hold = penaltyHold(this.serving);
    const range = (luck: number) =>
      hold + stopSeconds(this.turnError, this.wingRequest, luck);
    return [range(0), range(1)];
  }

  update(car: PitCarState, now: number, pressed: boolean): PitControl {
    const state = this.advance(car, now, pressed);
    const inLimit = this.inLimiter(car);
    this.startTimer(car, now);
    const inService = this.phase === "service" && !this.garageMode;
    const control: PitControl = {
      ...state,
      phase: this.phase,
      limit: inLimit ? this.layout.speedLimit / 3.6 : 0,
      grade: this.grade,
      pitTime: this.laneAt === null ? null : now - this.laneAt,
      stopTime: this.stopTime,
      serviceTime: inService ? now - this.serviceAt : 0,
      plan: this.shownPlan(),
      estimate: this.estimate(),
      wingChange: this.wingChange,
      choosingTyres:
        (this.phase === "lane" || this.phase === "boxing") && !this.serviced,
      distanceToBox: this.boxRemaining(car),
      queued: this.phase === "boxing" && this.queued,
      speedKph: Math.abs(car.speed) * 3.6,
      penalty: this.phase === "track" ? this.owed : this.serving,
      penaltyLeft: this.penaltyLeft(now),
    };
    if (this.leaving(car, inLimit)) this.reset();
    return control;
  }

  private leaving(car: PitCarState, inLimit: boolean): boolean {
    return this.phase === "lane" && (!inLimit || this.leftLane(car));
  }

  abort(): void {
    this.reset();
    this.waiting = false;
    this.garageReleased = false;
  }

  private reset(): void {
    this.phase = "track";
    this.grade = null;
    this.turnError = 0;
    this.stopping = false;
    this.queued = false;
    this.plan = null;
    this.serviced = false;
    this.stopTime = null;
    this.laneAt = null;
    this.wingChange = false;
    this.serving = noPenalty;
  }
}

export function pitReport(control: PitControl): [number, number] {
  const { phase } = control;
  if (phase === "service") {
    const duration = control.plan?.duration;
    return [
      report.service,
      duration === undefined
        ? waiting
        : Math.max(0, duration - control.serviceTime),
    ];
  }
  if (phase === "boxing")
    return [control.queued ? report.queued : report.boxing, waiting];
  if (phase === "lane") {
    const entering =
      control.choosingTyres && control.penalty.kind !== "drive-through";
    return [entering ? report.entering : report.leaving, waiting];
  }
  return [phase === "release" ? report.release : report.track, waiting];
}

export function steerCommand(
  car: { x: number; y: number; heading: number; speed: number },
  target: number[],
  speed: number,
): { steer: number; throttle: number; brake: number } {
  const [px = 0, py = 0] = target;
  const angle = Math.atan2(py - car.y, px - car.x) - car.heading;
  const reach = Math.max(1, Math.hypot(px - car.x, py - car.y));
  const wheel =
    Math.atan((2 * wheelbase * Math.sin(angle)) / reach) / steerLock;
  const room = speed - car.speed;
  return {
    steer: Math.max(-1, Math.min(1, wheel)),
    throttle: Math.max(0, Math.min(1, room * throttleGain)),
    brake:
      car.speed > brakeFloor ? Math.max(0, Math.min(1, -room * brakeGain)) : 0,
  };
}
