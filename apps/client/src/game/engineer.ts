import type { DamageAlert } from "./damage.ts";
import type { WeatherPlan } from "./weather-plan.ts";

export type Tone = "info" | "good" | "warn" | "box";

export interface RadioCall {
  topic: string;
  text: string;
  priority: number;
  tone: Tone;
}

export interface WeatherOutlook {
  clock: number;
  level: number;
  call: "slicks" | "inters" | "wets" | null;
  drying: boolean;
}

export interface RaceState {
  time: number;
  lap: number;
  lapShare: number;
  totalLaps: number | null;
  race: boolean;
  started: boolean;
  finished: boolean;
  lapTime: number;
  wear: number;
  worstWheel: number;
  tyreLapsLeft: number | null;
  weather: WeatherOutlook;
}

export type Chatter = "full" | "reduced" | "off";

type Shift = WeatherPlan["shifts"][number];

const wearMarks = [0.3, 0.5, 0.7, 0.85];
const wearPriority = [1, 2, 3, 3];
const freshTyres = 0.15;
const warnLaps = 2;
const rainWords = ["dry", "light rain", "heavy rain", "a storm"];
const wheelNames = ["front right", "front left", "rear right", "rear left"];
const trackLines: Record<string, string> = {
  slicks: "The racing line is dry enough for slicks now.",
  inters: "It's too wet for slicks now, intermediates are the tyre.",
  clearing:
    "Not enough standing water for full wets, intermediates are the tyre.",
  wets: "Standing water on the racing line, full wets are the tyre.",
};

function spoken(name: string): string {
  return name
    .toLowerCase()
    .split(/([\s-]+)/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function lapText(time: number): string {
  const minutes = Math.floor(time / 60);
  const rest = time - minutes * 60;
  return minutes > 0
    ? `${String(minutes)}:${rest.toFixed(1).padStart(4, "0")}`
    : rest.toFixed(1);
}

function rainOf(level: number): string {
  return rainWords[Math.max(0, Math.min(3, level))] ?? "rain";
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function forecastPart(before: number, after: number, lap: number): string {
  const at = `lap ${String(lap)}`;
  if (after === 0) return `rain stops on ${at}`;
  if (before === 0) return `${rainOf(after)} from ${at}`;
  return after > before
    ? `turning to ${rainOf(after)} from ${at}`
    : `easing to ${rainOf(after)} from ${at}`;
}

function whenText(laps: number, lap: number): string {
  if (laps <= 0) return "later this lap";
  if (laps === 1) return `next lap, lap ${String(lap)}`;
  return `in ${String(laps)} laps, around lap ${String(lap)}`;
}

function aheadText(before: number, after: number, when: string): string {
  if (after === 0) return `Rain stopping ${when}. The track will start drying.`;
  if (before === 0) return `${capital(rainOf(after))} expected ${when}.`;
  return after > before
    ? `Rain getting heavier ${when}, ${rainOf(after)} expected.`
    : `Rain easing to ${rainOf(after)} ${when}.`;
}

function nowText(before: number, after: number): string {
  if (after === 0) return "Rain has stopped. The track will start drying.";
  if (before === 0) return `It's raining now, ${rainOf(after)}.`;
  return after > before
    ? `Rain is getting heavier, ${rainOf(after)} now.`
    : `Rain is easing, ${rainOf(after)} now.`;
}

export class Engineer {
  private readonly pending: RadioCall[] = [];
  private wearCalled = 0;
  private peakWear = 0;
  private briefed = false;
  private weatherKey = "";
  private lastTrackCall = { key: "", at: -Infinity };
  private finished = false;
  private readonly warned = new Set<number>();
  private readonly arrived = new Set<number>();

  constructor(
    private readonly chatter: () => Chatter,
    private readonly forecast: WeatherPlan | null = null,
  ) {}

  private say(
    topic: string,
    text: string,
    priority: number,
    tone: Tone = "info",
  ): void {
    const chatter = this.chatter();
    if (chatter === "off") return;
    if (chatter === "reduced" && priority < 2) return;
    this.pending.push({ topic, text, priority, tone });
  }

  drain(): RadioCall[] {
    return this.pending.splice(0, this.pending.length);
  }

  brief(state: RaceState): void {
    if (this.briefed || !state.race) return;
    this.briefed = true;
    const start = this.forecast?.start ?? state.weather.level;
    const parts = [start === 0 ? "dry start" : `${rainOf(start)} at the start`];
    let before = start;
    this.shifts().forEach((shift, index) => {
      const lap = this.lapOf(shift, state);
      if (lap === null) return;
      parts.push(forecastPart(before, shift.level, lap));
      before = shift.level;
      if (this.lapsUntil(shift, state) <= warnLaps) this.warned.add(index);
    });
    const text =
      parts.length > 1
        ? parts.join(", ")
        : start === 0
          ? "dry all race, no rain expected"
          : `${rainOf(start)} all race`;
    this.say("forecast", `Weather for the race: ${text}.`, 3);
  }

  update(state: RaceState): RadioCall[] {
    if (!state.race || this.finished) return this.drain();
    if (state.finished) {
      this.finished = true;
      return this.drain();
    }
    if (!state.started) return this.drain();
    this.watchForecast(state);
    this.watchTrack(state);
    this.watchTyres(state);
    return this.drain();
  }

  ownFastest(time: number): void {
    this.say(
      "fastest",
      `That's the fastest lap of the race, ${lapText(time)}! Purple!`,
      3,
      "good",
    );
  }

  rivalFastest(name: string, time: number): void {
    this.say(
      "rival-fastest",
      `${spoken(name)} has the fastest lap, ${lapText(time)}.`,
      2,
    );
  }

  damage(alert: DamageAlert): void {
    this.say("damage", `${alert.title}. ${alert.detail}.`, 3, "warn");
  }

  qualifyingLap(time: number, position: number): void {
    const verdict =
      position === 1
        ? "That's provisional pole! Great lap!"
        : `That's P${String(position)} for now.`;
    this.say("q-lap", `${lapText(time)}. ${verdict}`, 3, "good");
  }

  qualifyingRun(outLap: boolean): void {
    if (outLap)
      this.say(
        "q-out",
        "Out lap. Get some heat in the tyres and the brakes, push from the line.",
        2,
      );
    else this.say("q-push", "OK, push now. This is your lap.", 2);
  }

  private shifts(): Shift[] {
    return this.forecast?.shifts ?? [];
  }

  private progress(state: RaceState): number {
    return state.started ? state.lap - 1 + state.lapShare : 0;
  }

  private lapsUntil(shift: Shift, state: RaceState): number {
    return (shift.at - state.weather.clock) / Math.max(1, state.lapTime);
  }

  private lapOf(shift: Shift, state: RaceState): number | null {
    const ahead = Math.max(0, this.lapsUntil(shift, state));
    const lap = Math.max(
      state.lap,
      Math.floor(this.progress(state) + ahead) + 1,
    );
    return state.totalLaps !== null && lap > state.totalLaps ? null : lap;
  }

  private levelBefore(index: number): number {
    return index === 0
      ? (this.forecast?.start ?? 0)
      : (this.shifts()[index - 1]?.level ?? 0);
  }

  private nextOutlook(index: number, state: RaceState): string {
    const after = this.shifts()[index]?.level ?? 0;
    const next = this.shifts()[index + 1];
    const lap = next ? this.lapOf(next, state) : null;
    if (next && lap !== null)
      return ` Forecast: ${forecastPart(after, next.level, lap)}.`;
    return after === 0
      ? " No more rain forecast."
      : " It stays wet to the flag.";
  }

  private watchForecast(state: RaceState): void {
    this.shifts().forEach((shift, index) => {
      const before = this.levelBefore(index);
      if (this.arrived.has(index)) return;
      if (state.weather.clock >= shift.at) {
        this.arrived.add(index);
        this.warned.add(index);
        this.say(
          "weather-now",
          `${nowText(before, shift.level)}${this.nextOutlook(index, state)}`,
          4,
          "warn",
        );
        return;
      }
      const lap = this.lapOf(shift, state);
      if (
        this.warned.has(index) ||
        lap === null ||
        this.lapsUntil(shift, state) > warnLaps
      )
        return;
      this.warned.add(index);
      this.say(
        "weather-ahead",
        aheadText(before, shift.level, whenText(lap - state.lap, lap)),
        3,
        "warn",
      );
    });
  }

  private watchTrack(state: RaceState): void {
    const { call, drying, clock } = state.weather;
    const key = call === "inters" && drying ? "clearing" : (call ?? "");
    if (key === this.weatherKey) return;
    this.weatherKey = key;
    if (!call) return;
    const last = this.lastTrackCall;
    if (key === last.key && clock - last.at < state.lapTime) return;
    this.lastTrackCall = { key, at: clock };
    this.say("track", trackLines[key] ?? "", 4, "warn");
  }

  private tyreLife(state: RaceState): string {
    const life = state.tyreLapsLeft;
    if (life === null) return "";
    const toGo =
      state.totalLaps === null
        ? Infinity
        : state.totalLaps - (state.lap - 1 + state.lapShare);
    if (life >= toGo) return " They'll make the flag.";
    const laps = Math.max(0, Math.floor(life));
    return laps === 1
      ? " About 1 lap left in them."
      : ` About ${String(laps)} laps left in them.`;
  }

  private markPassed(wear: number): number | null {
    if (wear < this.peakWear - freshTyres) this.wearCalled = 0;
    this.peakWear =
      this.wearCalled === 0 ? wear : Math.max(this.peakWear, wear);
    const before = this.wearCalled;
    while ((wearMarks[this.wearCalled] ?? Infinity) <= wear) this.wearCalled++;
    return this.wearCalled > before ? this.wearCalled - 1 : null;
  }

  private watchTyres(state: RaceState): void {
    const mark = this.markPassed(state.wear);
    if (mark === null) return;
    const worn = String(Math.round((wearMarks[mark] ?? 0) * 100));
    const worst = wheelNames[state.worstWheel] ?? "front left";
    const life = this.tyreLife(state);
    const lines = [
      `Tyres at ${worn}% wear.${life}`,
      `Tyres at half life, ${worst} is the worst.${life}`,
      `Tyres are going off now, ${worn}% worn, ${worst} worst.${life}`,
      `Tyres are nearly gone, ${worn}% worn. Grip will drop off fast.${life}`,
    ];
    this.say(
      "wear",
      lines[mark] ?? "",
      wearPriority[mark] ?? 3,
      mark >= 2 ? "warn" : "info",
    );
  }
}
