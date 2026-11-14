import { DamageMonitor } from "./damage.ts";
import type { CarTiming, Engine } from "./engine.ts";
import {
  type Chatter,
  Engineer,
  type RaceState,
  type WeatherOutlook,
} from "./engineer.ts";
import {
  type FastestLap,
  fastestOf,
  newFastest,
  rivalBests,
} from "./field-timing.ts";
import { frameIndex } from "./frame-layout.ts";
import type { GapView, Hud } from "./hud.ts";
import type { LapResult, LapTrace } from "./laptrace.ts";
import type { CarStatus } from "./mfd.ts";
import type { Radio } from "./radio.ts";
import {
  baseWearPerLap,
  defaultPitLoss,
  observedWear,
  type Plan,
  planRace,
  tyreLife,
  twoCompoundLaps,
} from "./strategy.ts";
import { surname } from "./tower.ts";
import type { TyreInfo } from "./tyres.ts";
import { weatherCall, type WeatherInfo } from "./weather.ts";
import { lapSeconds, type WeatherPlan } from "./weather-plan.ts";
import type { Entrant } from "./weekend.ts";

const pollPeriod = 0.25;
const trendWindow = 20;
const rainLevels = 3;
const wetTyre = 4;

const sameLap = (a: FastestLap | null, b: FastestLap | null) =>
  a?.car === b?.car && a?.time === b?.time;

export interface PitWallContext {
  engine: Engine;
  hud: Hud;
  trace: LapTrace;
  radio: Radio;
  entrants: Entrant[] | null;
  race: boolean;
  qualifying: boolean;
  totalLaps: number | null;
  trackLength: number;
  wearScale: number;
  weather: WeatherPlan | null;
  chatter: () => Chatter;
  fastest: (lapTime: number) => void;
}

interface Rival {
  car: number;
  name: string;
  gap: number;
}

interface GapSample {
  time: number;
  cars: [number, number];
  gaps: [number, number];
}

class GapTrends {
  private readonly samples: GapSample[] = [];

  views(
    now: number,
    ahead: Rival | null,
    behind: Rival | null,
  ): [GapView | null, GapView | null] {
    const rivals: [Rival | null, Rival | null] = [ahead, behind];
    const old = this.samples.find((s) => now - s.time <= trendWindow + 1);
    this.samples.push({
      time: now,
      cars: [ahead ? ahead.car : -1, behind ? behind.car : -1],
      gaps: [ahead ? ahead.gap : 0, behind ? behind.gap : 0],
    });
    while (
      this.samples.length > 0 &&
      (this.samples[0]?.time ?? now) < now - trendWindow - 2
    )
      this.samples.shift();
    const view = (slot: 0 | 1): GapView | null => {
      const rival = rivals[slot];
      if (!rival) return null;
      const same = old !== undefined && old.cars[slot] === rival.car;
      const trend = same ? rival.gap - old.gaps[slot] : 0;
      return { name: rival.name, gap: rival.gap, trend };
    };
    return [view(0), view(1)];
  }
}

export interface PlayerTick {
  frame: Float64Array;
  weather: WeatherInfo;
  status: CarStatus;
  tyres: TyreInfo;
}

function outlook(weather: WeatherInfo, fitted: number): WeatherOutlook {
  const title = weatherCall(weather, fitted).message?.title ?? "";
  return {
    clock: weather.clock,
    level: Math.round(weather.rain * rainLevels),
    call: title.includes("slicks")
      ? "slicks"
      : title.includes("intermediates")
        ? "inters"
        : title.includes("wets")
          ? "wets"
          : null,
    drying: fitted === wetTyre,
  };
}

function lastLap(frame: Float64Array): number | null {
  const time = frame[frameIndex.lastLapTime] ?? 0;
  return time > 0 ? time : null;
}

function boxLap(plan: Plan | null, lap: number): number | null {
  const stop = plan?.stops[0];
  return stop === undefined ? null : lap + stop - 1;
}

export class PitWall {
  readonly engineer: Engineer;
  private clock = -Infinity;
  private timing: CarTiming[] = [];
  private fastest: FastestLap | null = null;
  private readonly damage = new DamageMonitor();
  private plans: Plan[] = [];
  private plan: Plan | null = null;
  private readonly trends = new GapTrends();
  private stintStart = { lap: 1, wear: 0, compound: -1 };
  private observed: number | null = null;
  private cleanStreak = 0;
  private lapContacts = 0;
  private lapOffTracks = 0;
  private lastRun = -99;
  private lastTick: PlayerTick | null = null;

  constructor(private readonly ctx: PitWallContext) {
    this.engineer = new Engineer(ctx.chatter, ctx.weather);
    if (!ctx.race) return;
    this.plans = this.planFrom(1, null);
    const fitted = ctx.engine.tyreInfo().compound;
    this.plan =
      this.plans.find((plan) => plan.stints[0]?.compound === fitted) ??
      this.planFrom(1, fitted)[0] ??
      null;
  }

  get options(): Plan[] {
    return this.plans;
  }

  get chosen(): number {
    return this.plan ? this.plans.indexOf(this.plan) : -1;
  }

  choose(index: number): number | null {
    const plan = this.plans[index];
    if (!plan) return null;
    this.plan = plan;
    const first = plan.stints[0]?.compound ?? null;
    if (first !== null) this.ctx.engine.startTyres(first);
    return first;
  }

  nextCompound(): number | null {
    return this.plan?.stints[1]?.compound ?? null;
  }

  receive(timing: CarTiming[]): void {
    this.timing = timing;
  }

  private wearPerLap(compound: number): number[] {
    return observedWear(
      baseWearPerLap(this.ctx.wearScale),
      compound,
      this.observed,
    );
  }

  private planFrom(lap: number, fitted: number | null): Plan[] {
    const total = this.ctx.totalLaps ?? 0;
    const left = total - lap + 1;
    if (left <= 0) return [];
    const tyres = this.ctx.engine.tyreInfo();
    const wear = Math.max(...tyres.wheels.map((w) => w.wear));
    const compound = fitted ?? tyres.compound;
    return planRace({
      laps: left,
      wearPerLap: this.wearPerLap(compound),
      twoCompounds:
        total >= twoCompoundLaps && !this.ctx.engine.session().changedCompound,
      pitLoss: defaultPitLoss,
      start:
        lap > 1 || fitted !== null
          ? { compound, wear: lap > 1 ? wear : 0 }
          : null,
    });
  }

  private rival(row: CarTiming | undefined, gap: number): Rival | null {
    const entrant = row ? this.ctx.entrants?.[row.index] : undefined;
    if (!row || !entrant) return null;
    return { car: row.index, name: surname(entrant), gap };
  }

  private neighbours(): { ahead: Rival | null; behind: Rival | null } {
    const mine = this.timing[0];
    if (!mine || !this.ctx.race) return { ahead: null, behind: null };
    const at = (position: number) =>
      this.timing.find((row) => row.position === position && !row.retired);
    const ahead = at(mine.position - 1);
    const behind = at(mine.position + 1);
    const sameLap = (row: CarTiming | undefined) =>
      row !== undefined && row.lapsDown === mine.lapsDown;
    return {
      ahead: sameLap(ahead) ? this.rival(ahead, mine.gapAhead) : null,
      behind: sameLap(behind)
        ? this.rival(behind, behind?.gapAhead ?? 0)
        : null,
    };
  }

  private updateGaps(now: number, ahead: Rival | null, behind: Rival | null) {
    const [aheadView, behindView] = this.trends.views(now, ahead, behind);
    this.ctx.hud.setGaps(aheadView, behindView);
  }

  private watchFastest(now: number): void {
    const { engine, hud, trace } = this.ctx;
    const field = engine.fieldSectors();
    trace.setRivals(rivalBests(field, trace.boundaries.length + 1));
    const current = fastestOf(field);
    const fresh = newFastest(this.fastest, current);
    if (!sameLap(this.fastest, current)) this.showReference(current);
    this.fastest = current;
    hud.setFastestCar(current ? current.car : -1);
    if (fresh) this.announceFastest(fresh, now);
  }

  private showReference(lap: FastestLap | null): void {
    const { engine, hud, trackLength } = this.ctx;
    hud.setFieldReference(
      lap
        ? {
            trace: engine.bestTrace().trace,
            length: trackLength,
            label: `FL ${lap.car === 0 ? "YOU" : this.holderName(lap.car)}`,
          }
        : null,
    );
  }

  private holderName(car: number): string {
    const holder = this.ctx.entrants?.[car];
    return car === 0 || !holder ? "You" : surname(holder);
  }

  private announceFastest(fresh: FastestLap, now: number): void {
    const { hud } = this.ctx;
    const mine = fresh.car === 0;
    const name = this.holderName(fresh.car);
    if (mine && this.ctx.race) this.ctx.fastest(fresh.time);
    if (!mine && (this.ctx.qualifying || fresh.lap < 2)) return;
    hud.fastestLap(name, fresh.time, now);
    if (!mine && this.ctx.race) this.engineer.rivalFastest(name, fresh.time);
  }

  private lapsLeft(compound: number, wear: number): number | null {
    const perLap = this.wearPerLap(compound)[compound] ?? 0;
    return perLap > 0 ? Math.max(0, tyreLife(perLap) - wear / perLap) : null;
  }

  private raceState(tick: PlayerTick): RaceState {
    const { frame, weather, tyres } = tick;
    const { totalLaps, trackLength } = this.ctx;
    const time = frame[frameIndex.time] ?? 0;
    const lap = Math.max(1, frame[frameIndex.laps] ?? 1);
    const wears = tyres.wheels.map((w) => w.wear);
    const wear = Math.max(...wears);
    return {
      time,
      lap,
      lapShare: (frame[frameIndex.distFromStart] ?? 0) / trackLength,
      totalLaps,
      race: this.ctx.race,
      started: time > 0,
      finished: this.timing[0]?.finished === true,
      lapTime:
        lastLap(frame) ?? this.ctx.trace.bestTime ?? lapSeconds(trackLength),
      wear,
      worstWheel: wears.indexOf(wear),
      tyreLapsLeft: this.lapsLeft(tyres.compound, wear),
      weather: outlook(weather, tyres.compound),
    };
  }

  update(now: number, tick: PlayerTick): void {
    this.lastTick = tick;
    this.ctx.radio.update(now);
    if (now - this.clock < pollPeriod) return;
    this.clock = now;
    if (this.ctx.entrants) this.watchFastest(now);
    if (this.ctx.qualifying) this.watchRun();
    if (!this.ctx.race || this.timing.length === 0) {
      this.flush(now);
      return;
    }
    const { ahead, behind } = this.neighbours();
    this.updateGaps(now, ahead, behind);
    const state = this.raceState(tick);
    this.followStint(state.lap, state.wear, tick.tyres.compound);
    this.engineer.brief(state);
    const alert = this.damage.update(tick.status, tick.tyres);
    if (alert && state.started) this.engineer.damage(alert);
    this.ctx.radio.push(this.engineer.update(state), now);
    this.showStrategy(state.lap, state.tyreLapsLeft);
  }

  private flush(now: number): void {
    this.ctx.radio.push(this.engineer.drain(), now);
  }

  private watchRun(): void {
    const run = this.ctx.engine.session().playerRun;
    if (run === this.lastRun) return;
    if (run === 1 || run === 2) this.engineer.qualifyingRun(run === 1);
    this.lastRun = run;
  }

  private followStint(lap: number, wear: number, compound: number): void {
    if (compound !== this.stintStart.compound) {
      this.stintStart = { lap, wear, compound };
      this.observed = null;
    }
  }

  private showStrategy(lap: number, lifeLaps: number | null): void {
    this.ctx.hud.showStrategy({
      plan: this.plan,
      lap,
      boxLap: boxLap(this.plan, lap),
      lifeLaps,
    });
  }

  private judgeClean(result: LapResult): void {
    const contacts = this.timing[0]?.contacts ?? 0;
    const offTracks = this.ctx.engine.stewardCar(0).offTracks;
    const clean =
      result.valid &&
      contacts === this.lapContacts &&
      offTracks === this.lapOffTracks;
    this.lapContacts = contacts;
    this.lapOffTracks = offTracks;
    this.cleanStreak = clean ? this.cleanStreak + 1 : 0;
    if (clean) this.ctx.hud.cleanLap(this.cleanStreak);
  }

  private ownsFastest(time: number): boolean {
    if (!this.ctx.entrants) return false;
    const field = this.ctx.engine.fieldSectors();
    return field.fastestCar === 0 && Math.abs(field.fastestLap - time) < 0.01;
  }

  private replanAfterLap(state: RaceState): void {
    const wearDone = state.wear - this.stintStart.wear;
    const laps = state.lap - this.stintStart.lap;
    if (laps >= 1 && wearDone > 0) this.observed = wearDone / laps;
    this.plan = this.planFrom(state.lap, null)[0] ?? null;
  }

  onLap(result: LapResult, now: number): void {
    this.judgeClean(result);
    const tick = this.lastTick;
    if (!tick) return;
    const state = this.raceState(tick);
    if (this.ctx.race) {
      this.replanAfterLap(state);
      if (this.ownsFastest(result.time)) this.engineer.ownFastest(result.time);
    }
    if (this.ctx.qualifying && result.full && result.valid)
      this.engineer.qualifyingLap(
        result.time,
        this.qualifyingPlace(result.time),
      );
    this.ctx.radio.push(this.engineer.drain(), now);
  }

  private qualifyingPlace(time: number): number {
    return (
      1 +
      this.timing.filter(
        (row) =>
          row.index !== 0 && row.segmentBest > 0 && row.segmentBest < time,
      ).length
    );
  }
}
