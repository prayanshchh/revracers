import { describe, expect, test } from "vitest";
import {
  type Chatter,
  Engineer,
  type RaceState,
  type RadioCall,
  type Rival,
} from "../../apps/client/src/game/engineer.ts";
import { nextCall } from "../../apps/client/src/game/radio.ts";
import type { Plan } from "../../apps/client/src/game/strategy.ts";

const oneStop: Plan = {
  stints: [
    { compound: 1, laps: 6 },
    { compound: 2, laps: 6 },
  ],
  stops: [6],
  time: 0,
};

function rival(car: number, name: string, gap: number): Rival {
  return { car, name, gap, compound: 2, tyreAge: 12, inPit: false };
}

function state(over: Partial<RaceState> = {}): RaceState {
  return {
    time: 10,
    lap: 1,
    lapShare: 0.1,
    totalLaps: 12,
    race: true,
    started: true,
    position: 6,
    carCount: 22,
    ahead: null,
    behind: null,
    compound: 1,
    wear: 0.05,
    fuelLaps: 0.5,
    wingDamage: 0,
    weather: { rain: 0, soon: 0, call: null, minutesToRain: null },
    plan: oneStop,
    inPitLane: false,
    finished: false,
    lapTime: 98,
    ...over,
  };
}

function briefed(chatter: Chatter = "full"): Engineer {
  const engineer = new Engineer(chatter);
  engineer.brief(state({ started: false, time: -3 }));
  engineer.drain();
  return engineer;
}

function topics(calls: RadioCall[]): string[] {
  return calls.map((call) => call.topic);
}

describe("race engineer", () => {
  test("the pre-race brief gives the strategy and the planned stop lap", () => {
    const engineer = new Engineer("full");
    engineer.brief(state({ started: false, time: -3 }));
    const [brief] = engineer.drain();
    expect(brief?.text).toContain("medium - hard");
    expect(brief?.text).toContain("lap 6");
    expect(engineer.plannedBox).toBe(6);
    engineer.brief(state({ started: false, time: -2 }));
    expect(engineer.drain()).toEqual([]);
  });

  test("an overtake by the player is called a good move with the new position", () => {
    const engineer = briefed();
    engineer.passed(40, true, "RUIZ", 5, rival(3, "BELLAMY", 1.4));
    const [call] = engineer.drain();
    expect(call?.tone).toBe("good");
    expect(call?.text).toMatch(/P5/);
    expect(call?.text).toMatch(/good|great|nice|lovely/i);
    expect(call?.text).toContain("Bellamy is next, 1.4");
  });

  test("being passed names the car that got by", () => {
    const engineer = briefed();
    engineer.passed(40, false, "RUIZ", 7, null);
    const [call] = engineer.drain();
    expect(call?.text).toContain("Ruiz");
    expect(call?.text).toMatch(/P[67]/);
  });

  test("box is called once, on the planned lap, after the start of the lap and never in the pit lane", () => {
    const engineer = briefed();
    const calls = (over: Partial<RaceState>) =>
      topics(engineer.update(state(over)));
    expect(calls({ lap: 4, lapShare: 0.6, plan: oneStopFrom(4) })).toContain(
      "window",
    );
    expect(
      calls({ lap: 6, lapShare: 0.2, plan: oneStopFrom(6) }),
    ).not.toContain("box");
    expect(
      calls({ lap: 6, lapShare: 0.7, plan: oneStopFrom(6), inPitLane: true }),
    ).not.toContain("box");
    expect(calls({ lap: 6, lapShare: 0.7, plan: oneStopFrom(6) })).toContain(
      "box",
    );
    expect(
      calls({ lap: 6, lapShare: 0.8, plan: oneStopFrom(6) }),
    ).not.toContain("box");
  });

  test("a car within a second ahead is announced once, with its tyres", () => {
    const engineer = briefed();
    const close = rival(4, "VANCE", 0.8);
    const first = engineer.update(state({ time: 100, ahead: close }));
    expect(first.find((c) => c.topic === "ahead")?.text).toContain(
      "12-lap-old hards",
    );
    expect(
      topics(engineer.update(state({ time: 110, ahead: close }))),
    ).not.toContain("ahead");
    expect(
      topics(
        engineer.update(state({ time: 112, ahead: rival(9, "ODA", 0.7) })),
      ),
    ).toContain("ahead");
  });

  test("rain on the forecast is warned once, then the tyre call comes as a box call", () => {
    const engineer = briefed();
    const coming = {
      rain: 0,
      soon: 0.4,
      call: null,
      minutesToRain: 5,
    } as const;
    const warn = engineer.update(state({ weather: coming }));
    expect(warn.find((c) => c.topic === "rain")?.text).toMatch(/5 minutes/);
    expect(topics(engineer.update(state({ weather: coming })))).not.toContain(
      "rain",
    );
    const wet = { ...coming, rain: 0.5, call: "inters" } as const;
    const box = engineer.update(state({ weather: wet }));
    expect(box.find((c) => c.topic === "weather")).toMatchObject({
      tone: "box",
    });
    expect(topics(engineer.update(state({ weather: wet })))).not.toContain(
      "weather",
    );
  });

  test("fuel short is warned and the all-clear follows when it recovers", () => {
    const engineer = briefed();
    expect(
      topics(engineer.update(state({ lap: 3, fuelLaps: -0.4 }))),
    ).toContain("fuel");
    expect(topics(engineer.update(state({ lap: 4, fuelLaps: 0.3 })))).toContain(
      "fuel-ok",
    );
  });

  test("key calls only keeps box and strategy calls but drops the chatter", () => {
    const engineer = briefed("reduced");
    engineer.update(state({ lap: 6, lapShare: 0.7, plan: oneStopFrom(6) }));
    engineer.lapDone(
      {
        lap: 3,
        time: 98.2,
        personalBest: true,
        fastestOfRace: false,
        full: true,
      },
      state({ lap: 4, ahead: rival(2, "ODA", 2.1) }),
    );
    expect(topics(engineer.drain())).toEqual([]);
    const loud = briefed("reduced");
    expect(
      topics(
        loud.update(state({ lap: 6, lapShare: 0.7, plan: oneStopFrom(6) })),
      ),
    ).toContain("box");
    const silent = new Engineer("off");
    silent.brief(state({ started: false }));
    silent.passed(1, true, "RUIZ", 1, null);
    expect(silent.drain()).toEqual([]);
  });

  test("the chequered flag gets one message that matches the result", () => {
    const engineer = briefed();
    const win = engineer.update(state({ finished: true, position: 1 }));
    expect(win[0]?.text).toMatch(/won/);
    expect(engineer.update(state({ finished: true, position: 1 }))).toEqual([]);
    const podium = briefed();
    expect(
      podium.update(state({ finished: true, position: 3 }))[0]?.text,
    ).toMatch(/podium/);
  });

  test("a lap that sets the fastest lap of the race is called out", () => {
    const engineer = briefed();
    engineer.lapDone(
      {
        lap: 4,
        time: 96.4,
        personalBest: true,
        fastestOfRace: true,
        full: true,
      },
      state({ lap: 5 }),
    );
    const calls = engineer.drain();
    expect(calls.find((c) => c.topic === "fastest")?.text).toContain("1:36.4");
    expect(topics(calls)).not.toContain("pb");
  });
});

describe("team radio queue", () => {
  test("the most important call goes first and stale chatter is dropped", () => {
    const queue = [
      { topic: "gaps", text: "a", priority: 1, tone: "info" as const, at: 0 },
      { topic: "ahead", text: "b", priority: 2, tone: "info" as const, at: 9 },
      { topic: "box", text: "c", priority: 4, tone: "box" as const, at: 1 },
    ];
    expect(nextCall(queue, 14)?.topic).toBe("box");
    expect(nextCall(queue, 14)?.topic).toBe("ahead");
    expect(nextCall(queue, 14)).toBeNull();
  });
});

function oneStopFrom(lap: number): Plan {
  const left = 6 - lap + 1;
  return {
    stints: [
      { compound: 1, laps: Math.max(1, left) },
      { compound: 2, laps: 6 },
    ],
    stops: [Math.max(1, left)],
    time: 0,
  };
}
