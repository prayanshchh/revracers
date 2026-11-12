import type { CarTiming, Engine } from "./engine.ts";
import {
  type Chatter,
  Engineer,
  type RaceState,
  type Rival,
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
import { idealCompound, weatherCall, type WeatherInfo } from "./weather.ts";
import type { Entrant } from "./weekend.ts";

const pollPeriod = 0.25;
const trendWindow = 20;
const rainSoon = 0.2;
const forecastStep = 5;
const fuelNominal = 1.35;

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
  chatter: () => Chatter;
  fastest: (lapTime: number) => void;
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

function fuelMargin(
  tick: PlayerTick,
  totalLaps: number | null,
  lapsDone: number,
): number | null {
  if (!totalLaps) return null;
  const left = Math.max(0, totalLaps - lapsDone);
  return tick.fuel / Math.max(0.2, tick.fuelPerLap || fuelNominal) - left;
}

export interface PlayerTick {
  frame: Float64Array;
  inPitLane: boolean;
  weather: WeatherInfo;
  wingDamage: number;
  fuel: number;
  fuelPerLap: number;
}

function outlook(weather: WeatherInfo, fitted: number): WeatherOutlook {
  const call = weatherCall(weather, fitted);
  const title = call.message?.title ?? "";
  const soonAt = weather.forecast.findIndex((rain) => rain >= rainSoon);
  return {
    rain: weather.rain,
    soon: weather.forecast[0] ?? 0,
    call: title.includes("slicks")
      ? "slicks"
      : title.includes("intermediates")
        ? "inters"
        : title.includes("wets")
          ? "wets"
          : null,
    minutesToRain: soonAt >= 0 ? (soonAt + 1) * forecastStep : null,
  };
}

export class PitWall {
  readonly engineer: Engineer;
  private clock = -Infinity;
  private timing: CarTiming[] = [];
  private fastest: FastestLap | null = null;
  private passCursor = 0;
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
    this.engineer = new Engineer(ctx.chatter);
    this.passCursor = ctx.entrants ? ctx.engine.passes(0).total : 0;
    if (!ctx.race) return;
    const weather = ctx.engine.weather();
    const wet = idealCompound(
      Math.max(weather.lineWater, weather.forecast[0] ?? 0),
      weather,
      0,
    );
    if (wet > 2) {
      ctx.engine.startTyres(wet);
      return;
    }
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
    return {
      car: row.index,
      name: surname(entrant),
      gap,
      compound: row.compound,
      tyreAge: row.tyreAge,
      inPit: row.inPit,
    };
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
    if (!mine && this.ctx.race)
      this.engineer.rivalFastest(this.simTime(), name, fresh.time);
  }

  private simTime(): number {
    return this.lastTick?.frame[frameIndex.time] ?? 0;
  }

  private watchPasses(ahead: Rival | null): void {
    const { engine, entrants } = this.ctx;
    const { total, list } = engine.passes(this.passCursor);
    if (total < this.passCursor) this.passCursor = total;
    for (const pass of list) {
      this.passCursor++;
      if (pass.passer !== 0 && pass.passed !== 0) continue;
      const other = pass.passer === 0 ? pass.passed : pass.passer;
      const entrant = entrants?.[other];
      if (!entrant) continue;
      this.engineer.passed(
        pass.time,
        pass.passer === 0,
        surname(entrant),
        pass.passer === 0 ? pass.position : pass.position + 1,
        ahead,
      );
    }
  }

  private raceState(tick: PlayerTick): RaceState {
    const { frame, weather } = tick;
    const { engine, totalLaps, trackLength } = this.ctx;
    const mine = this.timing[0];
    const tyres = engine.tyreInfo();
    const time = frame[frameIndex.time] ?? 0;
    const lap = Math.max(1, frame[frameIndex.laps] ?? 1);
    const share = (frame[frameIndex.distFromStart] ?? 0) / trackLength;
    return {
      time,
      lap,
      lapShare: share,
      totalLaps,
      race: this.ctx.race,
      started: time > 0,
      position: mine ? mine.position : 1,
      carCount: this.timing.length,
      ...this.neighbours(),
      compound: tyres.compound,
      wear: Math.max(...tyres.wheels.map((w) => w.wear)),
      fuelLaps: fuelMargin(tick, totalLaps, lap - 1 + share),
      wingDamage: tick.wingDamage,
      weather: outlook(weather, tyres.compound),
      plan: this.plan,
      inPitLane: tick.inPitLane,
      finished: mine?.finished === true,
      lapTime: this.ctx.trace.bestTime ?? 100,
    };
  }

  brief(tick: PlayerTick): void {
    if (!this.ctx.race) return;
    this.lastTick = tick;
    this.engineer.brief(this.raceState(tick));
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
    const state = this.raceState(tick);
    this.updateGaps(now, state.ahead, state.behind);
    this.watchPasses(state.ahead);
    this.followStint(state);
    this.engineer.brief(state);
    this.ctx.radio.push(this.engineer.update(state), now);
    this.showStrategy(state);
  }

  private flush(now: number): void {
    this.ctx.radio.push(this.engineer.drain(), now);
  }

  private watchRun(): void {
    const run = this.ctx.engine.session().playerRun;
    if (run === this.lastRun) return;
    if (run === 1 || run === 2)
      this.engineer.qualifyingRun(this.simTime(), run === 1);
    this.lastRun = run;
  }

  private followStint(state: RaceState): void {
    if (state.compound !== this.stintStart.compound) {
      this.stintStart = {
        lap: state.lap,
        wear: state.wear,
        compound: state.compound,
      };
      this.observed = null;
    }
  }

  private showStrategy(state: RaceState): void {
    const perLap = this.wearPerLap(state.compound)[state.compound] ?? 0;
    this.ctx.hud.showStrategy({
      plan: this.plan,
      lap: state.lap,
      boxLap: this.engineer.plannedBox,
      lifeLaps:
        perLap > 0 ? Math.max(0, tyreLife(perLap) - state.wear / perLap) : null,
    });
  }

  onSector(index: number, status: string | null): void {
    if (status === "pb" && (this.ctx.race || this.ctx.qualifying))
      this.engineer.purpleSector(this.simTime(), index);
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
    state.plan = this.plan;
  }

  onLap(result: LapResult, now: number): void {
    this.judgeClean(result);
    const tick = this.lastTick;
    if (!tick) return;
    const state = this.raceState(tick);
    if (this.ctx.race) this.replanAfterLap(state);
    this.engineer.lapDone(
      {
        lap: result.lap,
        time: result.time,
        personalBest: result.best,
        fastestOfRace: this.ownsFastest(result.time),
        full: result.full,
      },
      state,
    );
    if (this.ctx.qualifying && result.full && result.valid)
      this.engineer.qualifyingLap(
        state.time,
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
