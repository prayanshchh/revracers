import { compoundName, type Plan, planSummary } from "./strategy.ts";

export type Tone = "info" | "good" | "warn" | "box";

export interface RadioCall {
  topic: string;
  text: string;
  priority: number;
  tone: Tone;
}

export interface Rival {
  car: number;
  name: string;
  gap: number;
  compound: number;
  tyreAge: number;
  inPit: boolean;
}

export interface WeatherOutlook {
  rain: number;
  soon: number;
  call: "slicks" | "inters" | "wets" | null;
  minutesToRain: number | null;
}

export interface RaceState {
  time: number;
  lap: number;
  lapShare: number;
  totalLaps: number | null;
  race: boolean;
  started: boolean;
  position: number;
  carCount: number;
  ahead: Rival | null;
  behind: Rival | null;
  compound: number;
  wear: number;
  fuelLaps: number | null;
  wingDamage: number;
  weather: WeatherOutlook;
  plan: Plan | null;
  inPitLane: boolean;
  finished: boolean;
  lapTime: number;
}

export interface LapReport {
  lap: number;
  time: number;
  personalBest: boolean;
  fastestOfRace: boolean;
  full: boolean;
}

export type Chatter = "full" | "reduced" | "off";

const closeGap = 1.0;
const minGap = 0.05;
const rivalRepeat = 100;
const gapEvery = 3;
const purpleRepeat = 40;
const fuelShort = -0.15;
const wingWarn = 0.3;
const wingBad = 0.6;
const wearMarks = [0.5, 0.72];
const boxShare = 0.45;
const windowLaps = 2;
const wetAhead = 0.2;

function spoken(name: string): string {
  return name
    .toLowerCase()
    .split(/([\s-]+)/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function seconds(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

function lapText(time: number): string {
  const minutes = Math.floor(time / 60);
  const rest = time - minutes * 60;
  return minutes > 0
    ? `${String(minutes)}:${rest.toFixed(1).padStart(4, "0")}`
    : rest.toFixed(1);
}

function tyreWords(rival: Rival): string {
  const name = compoundName(rival.compound).toLowerCase();
  if (rival.tyreAge <= 1) return `fresh ${name}s`;
  return `${String(rival.tyreAge)}-lap-old ${name}s`;
}

function pick(options: string[], seed: number): string {
  return options[Math.abs(Math.floor(seed)) % options.length] ?? "";
}

function place(position: number): string {
  return `P${String(position)}`;
}

function finishLine(position: number, cars: number): string {
  if (position === 1)
    return "Yes! Yes! You've won the race! Fantastic job, mate!";
  if (position <= 3)
    return `${place(position)}, that's a podium! Brilliant drive.`;
  if (position <= 10)
    return `Chequered flag, ${place(position)}. Good points today, well done.`;
  return position === cars
    ? `Chequered flag, ${place(position)}. Tough one. We'll learn from it.`
    : `Chequered flag, ${place(position)}. Not our day, we'll go again.`;
}

function aheadReport(ahead: Rival, before: number | null): string {
  const trend = before === null ? null : (ahead.gap - before) / gapEvery;
  const pace =
    trend === null || Math.abs(trend) < 0.05
      ? ""
      : trend < 0
        ? `, you're gaining ${Math.abs(trend).toFixed(1)} a lap`
        : `, losing ${trend.toFixed(1)} a lap`;
  return `Gap to ${spoken(ahead.name)} ${seconds(ahead.gap)}${pace}.`;
}

function boxPlan(plan: Plan | null, lap: number): number | null {
  const stop = plan?.stops[0];
  return stop === undefined ? null : lap + stop - 1;
}

export class Engineer {
  private readonly said = new Map<string, number>();
  private readonly pending: RadioCall[] = [];
  private wearCalled = 0;
  private wingCalled = 0;
  private fuelWarned = false;
  private briefed = false;
  private startPosition = 0;
  private lastLapSeen = 0;
  private boxLap: number | null = null;
  private boxCalled = -1;
  private windowCalled = -1;
  private weatherKey = "";
  private rainWarned = false;
  private finished = false;
  private gapHistory: { lap: number; ahead: number | null }[] = [];
  private wasInPit = false;
  private lastPlan = "";
  private counter = 0;

  constructor(private readonly chatter: () => Chatter) {}

  private ready(topic: string, now: number, repeat: number): boolean {
    const last = this.said.get(topic);
    return last === undefined || now - last >= repeat;
  }

  private say(
    now: number,
    topic: string,
    text: string,
    priority: number,
    tone: Tone = "info",
  ): void {
    const chatter = this.chatter();
    if (chatter === "off") return;
    if (chatter === "reduced" && priority < 2) return;
    this.said.set(topic, now);
    this.counter++;
    this.pending.push({ topic, text, priority, tone });
  }

  drain(): RadioCall[] {
    return this.pending.splice(0, this.pending.length);
  }

  get plannedBox(): number | null {
    return this.boxLap;
  }

  brief(state: RaceState): void {
    if (this.briefed || !state.race) return;
    this.briefed = true;
    this.startPosition = state.position;
    const plan = state.plan;
    if (!plan) {
      this.say(
        state.time,
        "brief",
        `Radio check. Track is wet, start on ${compoundName(state.compound).toLowerCase()}s and keep it on the island.`,
        2,
      );
      return;
    }
    this.boxLap = boxPlan(plan, 1);
    this.lastPlan = plan.stops.join();
    const stops =
      this.boxLap === null
        ? "No stop planned, look after the tyres."
        : `Plan to box around lap ${String(this.boxLap)}.`;
    this.say(
      state.time,
      "brief",
      `Radio check. Strategy is ${planSummary(plan).toLowerCase()}. You start ${place(state.position)}. ${stops}`,
      2,
    );
  }

  update(state: RaceState): RadioCall[] {
    if (!state.race || this.finished) return this.drain();
    if (state.finished) {
      this.finished = true;
      this.say(
        state.time,
        "finish",
        finishLine(state.position, state.carCount),
        4,
        state.position <= 3 ? "good" : "info",
      );
      return this.drain();
    }
    if (!state.started) return this.drain();
    this.followPlan(state);
    this.watchPit(state);
    this.watchRivals(state);
    this.watchTyres(state);
    this.watchFuel(state);
    this.watchWing(state);
    this.watchWeather(state);
    return this.drain();
  }

  passed(
    now: number,
    byPlayer: boolean,
    name: string,
    position: number,
    next: Rival | null,
  ): void {
    if (byPlayer) {
      const lead = position === 1;
      const line = lead
        ? `Brilliant move on ${spoken(name)}! You're leading the race!`
        : pick(
            [
              `Good overtake! That's ${place(position)}.`,
              `Great move on ${spoken(name)}, ${place(position)}.`,
              `Nicely done, clean pass. ${place(position)} now.`,
              `Lovely move! ${place(position)}.`,
            ],
            this.counter + position,
          );
      const chase =
        next && !lead
          ? ` ${spoken(next.name)} is next, ${seconds(next.gap)} up the road.`
          : "";
      this.say(now, "pass", `${line}${chase}`, 3, "good");
      return;
    }
    this.say(
      now,
      "passed",
      pick(
        [
          `${spoken(name)} is through, you're ${place(position)}. Stay with them.`,
          `Lost ${place(position - 1)} to ${spoken(name)}. Keep your head down, we'll get it back.`,
          `${spoken(name)} got by. ${place(position)}. Let's go again.`,
        ],
        this.counter + position,
      ),
      3,
      "warn",
    );
  }

  lapDone(report: LapReport, state: RaceState): void {
    const now = state.time;
    if (report.fastestOfRace) {
      this.say(
        now,
        "fastest",
        `That's the fastest lap of the race, ${lapText(report.time)}! Purple!`,
        3,
        "good",
      );
    } else if (report.personalBest && report.full) {
      this.say(
        now,
        "pb",
        `Personal best, ${lapText(report.time)}. Good lap.`,
        1,
        "good",
      );
    }
    if (!state.race) return;
    if (report.lap === 1 && this.startPosition > 0) this.startReport(state);
    this.gapReport(report.lap, state);
    this.countdown(report.lap + 1, state);
  }

  rivalFastest(now: number, name: string, time: number): void {
    this.say(
      now,
      "rival-fastest",
      `${spoken(name)} has the fastest lap, ${lapText(time)}.`,
      1,
    );
  }

  purpleSector(now: number, sector: number): void {
    if (!this.ready("purple", now, purpleRepeat)) return;
    this.say(
      now,
      "purple",
      `Purple sector ${String(sector + 1)}. Keep pushing.`,
      1,
      "good",
    );
  }

  qualifyingLap(now: number, time: number, position: number): void {
    const verdict =
      position === 1
        ? "That's provisional pole! Great lap!"
        : `That's ${place(position)} for now.`;
    this.say(now, "q-lap", `${lapText(time)}. ${verdict}`, 3, "good");
  }

  qualifyingRun(now: number, outLap: boolean): void {
    if (outLap)
      this.say(
        now,
        "q-out",
        "Out lap. Get some heat in the tyres and the brakes, push from the line.",
        2,
      );
    else this.say(now, "q-push", "OK, push now. This is your lap.", 2);
  }

  private startReport(state: RaceState): void {
    const gained = this.startPosition - state.position;
    const text =
      gained > 0
        ? `Great start, up ${String(gained)} place${gained > 1 ? "s" : ""}. ${place(state.position)}.`
        : gained < 0
          ? `Lost ${String(-gained)} on the opening lap. ${place(state.position)}, long way to go.`
          : `Held position, ${place(state.position)}. Settle in now.`;
    this.say(state.time, "start", text, 2, gained >= 0 ? "good" : "info");
  }

  private rememberGap(lap: number, ahead: Rival | null): number | null {
    this.gapHistory.push({ lap, ahead: ahead ? ahead.gap : null });
    if (this.gapHistory.length > 6) this.gapHistory.shift();
    return this.gapHistory.at(-gapEvery - 1)?.ahead ?? null;
  }

  private gapReport(lap: number, state: RaceState): void {
    const before = this.rememberGap(lap, state.ahead);
    if (lap < 2 || lap % gapEvery !== 0) return;
    const parts = [
      state.ahead ? aheadReport(state.ahead, before) : "",
      state.behind
        ? `${spoken(state.behind.name)} ${seconds(state.behind.gap)} behind.`
        : "",
    ].filter((part) => part !== "");
    if (parts.length > 0)
      this.say(state.time, "gaps", parts.join(" "), 1, "info");
  }

  private countdown(next: number, state: RaceState): void {
    const total = state.totalLaps;
    if (!total || next > total) return;
    if (next === total)
      this.say(
        state.time,
        "last-lap",
        `Final lap. ${place(state.position)}. Bring it home.`,
        2,
      );
    else if (next === total - 1 && total > 3)
      this.say(state.time, "two-to-go", "Two laps to go after this one.", 1);
  }

  private replan(state: RaceState): void {
    if (state.lap === this.lastLapSeen) return;
    this.lastLapSeen = state.lap;
    const box = boxPlan(state.plan, state.lap);
    const key = state.plan?.stops.join() ?? "";
    const known = this.boxLap;
    if (
      box !== null &&
      known !== null &&
      Math.abs(box - known) >= 2 &&
      key !== this.lastPlan
    )
      this.say(
        state.time,
        "replan",
        box < known
          ? `Tyres are wearing faster than planned. New target: box lap ${String(box)}.`
          : `Tyres are holding up well. We can extend, box lap ${String(box)}.`,
        2,
        "warn",
      );
    this.boxLap = box;
    this.lastPlan = key;
  }

  private windowCall(state: RaceState, box: number, tyre: string): void {
    if (state.lap !== box - windowLaps || this.windowCalled === box) return;
    this.windowCalled = box;
    this.say(
      state.time,
      "window",
      `Pit window opens soon. Target lap ${String(box)} for ${tyre}.`,
      2,
    );
  }

  private followPlan(state: RaceState): void {
    this.replan(state);
    const box = this.boxLap;
    const next = state.plan?.stints[1]?.compound;
    if (box === null || next === undefined) return;
    const tyre = `${compoundName(next).toLowerCase()}s`;
    this.windowCall(state, box, tyre);
    const due = state.lap === box && state.lapShare >= boxShare;
    if (!due || this.boxCalled === box || state.inPitLane) return;
    this.boxCalled = box;
    this.say(
      state.time,
      "box",
      `Box, box. Box this lap for ${tyre}.`,
      4,
      "box",
    );
  }

  private watchPit(state: RaceState): void {
    if (this.wasInPit && !state.inPitLane) {
      this.wearCalled = 0;
      this.wingCalled = 0;
      this.say(
        state.time,
        "out-lap",
        `Good stop. You rejoin ${place(state.position)}. ${state.ahead ? `${spoken(state.ahead.name)} ahead by ${seconds(state.ahead.gap)}.` : "Clear air, push now."}`,
        2,
      );
    }
    this.wasInPit = state.inPitLane;
  }

  private nearby(rival: Rival | null, reach: number, now: number): boolean {
    if (!rival || rival.inPit || rival.gap <= minGap || rival.gap > reach)
      return false;
    const key = `near-${String(rival.car)}`;
    if (!this.ready(key, now, rivalRepeat)) return false;
    this.said.set(key, now);
    return true;
  }

  private watchRivals(state: RaceState): void {
    const { ahead, behind, time } = state;
    if (ahead && this.nearby(ahead, closeGap, time))
      this.say(
        time,
        "ahead",
        `${spoken(ahead.name)} ahead, ${seconds(ahead.gap)}. They're on ${tyreWords(ahead)}. You're in overtake range.`,
        2,
      );
    if (behind && this.nearby(behind, closeGap * 0.8, time))
      this.say(
        time,
        "behind",
        `${spoken(behind.name)} is right behind, ${seconds(behind.gap)}. Defend your position.`,
        2,
        "warn",
      );
  }

  private watchTyres(state: RaceState): void {
    const mark = wearMarks[this.wearCalled];
    if (mark === undefined || state.wear < mark) return;
    this.wearCalled++;
    const laps = state.totalLaps ? state.totalLaps - state.lap + 1 : null;
    const coming =
      this.boxLap !== null && this.boxLap >= state.lap
        ? ` We box in ${String(this.boxLap - state.lap)} laps.`
        : laps !== null && laps > 1
          ? ` They need to last ${String(laps)} more laps.`
          : "";
    this.say(
      state.time,
      "wear",
      this.wearCalled === 1
        ? `Tyres are at about half life.${coming}`
        : `Tyres are going off now, look after the rears.${coming}`,
      2,
      "warn",
    );
  }

  private watchFuel(state: RaceState): void {
    const fuel = state.fuelLaps;
    if (fuel === null || state.lap < 2) return;
    if (fuel < fuelShort && this.ready("fuel", state.time, 150)) {
      this.fuelWarned = true;
      this.say(
        state.time,
        "fuel",
        `We're ${Math.abs(fuel).toFixed(1)} laps short on fuel. Lift and coast into the big stops, switch to lean mix.`,
        3,
        "warn",
      );
    } else if (this.fuelWarned && fuel > 0.1) {
      this.fuelWarned = false;
      this.say(state.time, "fuel-ok", "Fuel is OK now. Back to normal.", 2);
    }
  }

  private watchWing(state: RaceState): void {
    const level =
      state.wingDamage >= wingBad ? 2 : state.wingDamage >= wingWarn ? 1 : 0;
    if (level <= this.wingCalled) return;
    this.wingCalled = level;
    this.say(
      state.time,
      "wing",
      level === 2
        ? "Front wing is badly damaged. Box this lap, we'll change the nose."
        : "We see front wing damage. Box for a new nose if the balance is bad.",
      level === 2 ? 4 : 3,
      level === 2 ? "box" : "warn",
    );
  }

  private watchWeather(state: RaceState): void {
    const { weather } = state;
    if (
      !this.rainWarned &&
      weather.rain < 0.05 &&
      weather.soon >= wetAhead &&
      weather.minutesToRain !== null
    ) {
      this.rainWarned = true;
      const lapsAway = Math.max(
        1,
        Math.round((weather.minutesToRain * 60) / Math.max(60, state.lapTime)),
      );
      this.say(
        state.time,
        "rain",
        `Rain expected in about ${String(Math.round(weather.minutesToRain))} minutes, around lap ${String(state.lap + lapsAway)}. Stay out for now, we'll call it.`,
        3,
        "warn",
      );
    }
    if (weather.rain < 0.05 && weather.soon < 0.05) this.rainWarned = false;
    const key = weather.call ?? "";
    if (key === this.weatherKey) return;
    this.weatherKey = key;
    if (!weather.call) return;
    const lines = {
      slicks: "Track is drying. Box, box for slicks.",
      inters: "It's too wet for slicks now. Box, box for intermediates.",
      wets: "Standing water on the racing line. Box for full wets.",
    } as const;
    this.say(state.time, "weather", lines[weather.call], 4, "box");
  }
}
