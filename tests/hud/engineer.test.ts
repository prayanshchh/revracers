import { describe, expect, test } from "vitest";
import {
  type Chatter,
  Engineer,
  type RaceState,
  type RadioCall,
} from "../../apps/client/src/game/engineer.ts";
import { nextCall } from "../../apps/client/src/game/radio.ts";
import type { WeatherPlan } from "../../apps/client/src/game/weather-plan.ts";

const lapTime = 100;

const rainComing: WeatherPlan = {
  story: "rain",
  start: 0,
  shifts: [
    { at: 420, level: 1 },
    { at: 730, level: 2 },
  ],
};

const drying: WeatherPlan = {
  story: "drying",
  start: 2,
  shifts: [
    { at: 250, level: 1 },
    { at: 520, level: 0 },
  ],
};

function state(over: Partial<RaceState> = {}): RaceState {
  return {
    time: 10,
    lap: 1,
    lapShare: 0.1,
    totalLaps: 12,
    race: true,
    started: true,
    finished: false,
    lapTime,
    wear: 0.05,
    worstWheel: 1,
    tyreLapsLeft: 20,
    weather: { clock: 10, level: 0, call: null, drying: false },
    ...over,
  };
}

function at(clock: number, over: Partial<RaceState> = {}): RaceState {
  const progress = clock / lapTime;
  return state({
    time: clock,
    lap: Math.floor(progress) + 1,
    lapShare: progress % 1,
    weather: { clock, level: 0, call: null, drying: false },
    ...over,
  });
}

const grid = (level = 0) =>
  state({
    started: false,
    time: 0,
    lapShare: 0.98,
    weather: { clock: 0, level, call: null, drying: false },
  });

function briefText(
  plan: WeatherPlan | null,
  over: Partial<RaceState> = {},
): string {
  const engineer = new Engineer(() => "full", plan);
  engineer.brief({ ...grid(), ...over });
  return engineer.drain()[0]?.text ?? "";
}

function briefed(plan: WeatherPlan | null = null, chatter: Chatter = "full") {
  const engineer = new Engineer(() => chatter, plan);
  engineer.brief(grid());
  engineer.drain();
  return engineer;
}

function said(calls: RadioCall[], topic: string): string[] {
  return calls.filter((call) => call.topic === topic).map((call) => call.text);
}

describe("race engineer", () => {
  test("the grid brief gives the race's weather lap by lap, leaving out changes after the flag", () => {
    expect(briefText(rainComing)).toBe(
      "Weather for the race: dry start, light rain from lap 5, turning to heavy rain from lap 8.",
    );
    expect(briefText(drying)).toBe(
      "Weather for the race: heavy rain at the start, easing to light rain from lap 3, rain stops on lap 6.",
    );
    expect(briefText(rainComing, { totalLaps: 6 })).toBe(
      "Weather for the race: dry start, light rain from lap 5.",
    );
    expect(
      briefText(null, {
        weather: { clock: 0, level: 1, call: null, drying: false },
      }),
    ).toBe("Weather for the race: light rain all race.");
    expect(briefText(null)).toBe(
      "Weather for the race: dry all race, no rain expected.",
    );
  });

  test("each weather change is warned two laps ahead with its lap, then called when it arrives with what comes next", () => {
    const engineer = briefed(rainComing);
    const weather = (clock: number) => {
      const calls = engineer.update(at(clock));
      return [...said(calls, "weather-ahead"), ...said(calls, "weather-now")];
    };
    expect(weather(150)).toEqual([]);
    expect(weather(230)).toEqual([
      "Light rain expected in 2 laps, around lap 5.",
    ]);
    expect(weather(240)).toEqual([]);
    expect(weather(425)).toEqual([
      "It's raining now, light rain. Forecast: turning to heavy rain from lap 8.",
    ]);
    expect(weather(430)).toEqual([]);
    expect(weather(540)).toEqual([
      "Rain getting heavier in 2 laps, around lap 8, heavy rain expected.",
    ]);
    expect(weather(735)).toEqual([
      "Rain is getting heavier, heavy rain now. It stays wet to the flag.",
    ]);
  });

  test("the end of the rain is called with the drying track and no more rain to come", () => {
    const engineer = briefed(drying);
    expect(said(engineer.update(at(330)), "weather-ahead")).toEqual([
      "Rain stopping in 2 laps, around lap 6. The track will start drying.",
    ]);
    expect(said(engineer.update(at(525)), "weather-now")).toEqual([
      "Rain has stopped. The track will start drying. No more rain forecast.",
    ]);
  });

  test("the slick or wet call is made when the track changes, says when wets are more than needed, and does not flicker", () => {
    const engineer = briefed();
    const track = (
      clock: number,
      call: RaceState["weather"]["call"],
      drying = false,
    ) =>
      said(
        engineer.update(state({ weather: { clock, level: 1, call, drying } })),
        "track",
      );
    const tooWet = "It's too wet for slicks now, intermediates are the tyre.";
    expect(track(100, "inters")).toEqual([tooWet]);
    expect(track(105, "inters")).toEqual([]);
    expect(track(110, null)).toEqual([]);
    expect(track(115, "inters")).toEqual([]);
    expect(track(150, null)).toEqual([]);
    expect(track(250, "inters")).toEqual([tooWet]);
    expect(track(260, "wets")).toEqual([
      "Standing water on the racing line, full wets are the tyre.",
    ]);
    expect(track(400, "inters", true)).toEqual([
      "Not enough standing water for full wets, intermediates are the tyre.",
    ]);
    expect(track(500, "slicks")).toEqual([
      "The racing line is dry enough for slicks now.",
    ]);
  });

  test("tyre wear is reported at each mark with the worst corner and the laps left, and starts again on fresh tyres", () => {
    const engineer = briefed();
    const wear = (over: Partial<RaceState>) =>
      said(engineer.update(state({ lap: 3, lapShare: 0, ...over })), "wear");
    expect(wear({ wear: 0.31, tyreLapsLeft: 9.6 })).toEqual([
      "Tyres at 30% wear. About 9 laps left in them.",
    ]);
    expect(wear({ wear: 0.33, tyreLapsLeft: 9.4 })).toEqual([]);
    expect(wear({ wear: 0.72, tyreLapsLeft: 2.5, worstWheel: 2 })).toEqual([
      "Tyres are going off now, 70% worn, rear right worst. About 2 laps left in them.",
    ]);
    expect(wear({ wear: 0.02, tyreLapsLeft: 30 })).toEqual([]);
    expect(wear({ wear: 0.51, tyreLapsLeft: 12 })).toEqual([
      "Tyres at half life, front left is the worst. They'll make the flag.",
    ]);
  });

  test("fastest laps name who set them and the time", () => {
    const engineer = briefed();
    engineer.rivalFastest("DE LA ROSA", 95.94);
    engineer.ownFastest(95.42);
    const calls = engineer.drain();
    expect(said(calls, "rival-fastest")).toEqual([
      "De La Rosa has the fastest lap, 1:35.9.",
    ]);
    expect(said(calls, "fastest")).toEqual([
      "That's the fastest lap of the race, 1:35.4! Purple!",
    ]);
  });

  test("key calls only drops just the first tyre mark, off is silent, and a change mid-race applies at once", () => {
    let chatter: Chatter = "reduced";
    const engineer = new Engineer(() => chatter, rainComing);
    engineer.brief(grid());
    engineer.rivalFastest("RUIZ", 96);
    engineer.damage({
      title: "Floor damage",
      detail: "Large loss of downforce",
    });
    const reduced = engineer.update(at(230, { wear: 0.31 }));
    expect(reduced.map((call) => call.topic).sort()).toEqual([
      "damage",
      "forecast",
      "rival-fastest",
      "weather-ahead",
    ]);
    chatter = "off";
    engineer.ownFastest(95);
    expect(engineer.update(at(425))).toEqual([]);
    chatter = "full";
    engineer.ownFastest(95);
    expect(engineer.drain().map((call) => call.topic)).toEqual(["fastest"]);
  });

  test("after the chequered flag the radio goes quiet", () => {
    const engineer = briefed(rainComing);
    expect(engineer.update(at(300, { finished: true }))).toEqual([]);
    expect(engineer.update(at(425, { wear: 0.9 }))).toEqual([]);
  });
});

describe("team radio queue", () => {
  test("the most important call goes first and stale chatter is dropped", () => {
    const queue = [
      { topic: "wear", text: "a", priority: 1, tone: "info" as const, at: 0 },
      { topic: "damage", text: "b", priority: 3, tone: "warn" as const, at: 9 },
      {
        topic: "weather-now",
        text: "c",
        priority: 4,
        tone: "warn" as const,
        at: 1,
      },
    ];
    expect(nextCall(queue, 14)?.topic).toBe("weather-now");
    expect(nextCall(queue, 14)?.topic).toBe("damage");
    expect(nextCall(queue, 14)).toBeNull();
  });
});
