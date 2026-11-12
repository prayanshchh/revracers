import { describe, expect, test } from "vitest";
import {
  Highlights,
  type Pass,
} from "../../apps/client/src/game/highlights.ts";
import { ReplayTape } from "../../apps/client/src/game/replay.ts";

function pass(time: number, position: number, passer = 0): Pass {
  return { time, passer, passed: position + 1, position, lap: 2 };
}

function recorder() {
  const cuts: [number, number][] = [];
  const highlights = new Highlights(0, (from, to) => {
    cuts.push([from, to]);
    return new ReplayTape(1, to - from);
  });
  let total = 0;
  const run = (time: number, fresh: Pass[] = []) => {
    total += fresh.length;
    highlights.update(time, total, fresh);
  };
  return { highlights, cuts, run };
}

describe("race highlights", () => {
  test("passes close together share one clip, cut once the moment is over", () => {
    const { highlights, cuts, run } = recorder();
    run(10, [pass(10, 6), pass(10, 9, 7)]);
    run(12, [pass(12, 5)]);
    run(14);
    expect(cuts).toEqual([]);
    run(14.6);
    expect(cuts).toEqual([[5, 14.5]]);
    run(40, [pass(40, 4)]);
    const reel = highlights.story(10);
    expect(reel.map((clip) => clip.passes.map((p) => p.position))).toEqual([
      [6, 5],
      [4],
    ]);
  });

  test("a flashback forgets overtakes that have not happened yet", () => {
    const { highlights, run } = recorder();
    run(10, [pass(10, 6)]);
    run(20, [pass(20, 5)]);
    run(30);
    highlights.update(15, 1, []);
    expect(highlights.from).toBe(1);
    expect(
      highlights.story(10).map((clip) => clip.passes[0]?.position),
    ).toEqual([6]);
  });

  test("the reel keeps the passes for the best places, in race order", () => {
    const { highlights, run } = recorder();
    [10, 9, 8, 7, 6, 5, 4, 1].forEach((position, k) => {
      run(20 + k * 30, [pass(20 + k * 30, position)]);
    });
    run(400);
    expect(highlights.story(6).map((clip) => clip.passes[0]?.position)).toEqual(
      [8, 7, 6, 5, 4, 1],
    );
  });

  test("rivals fighting for the lead or the podium make the highlights, following the car that passed", () => {
    const { highlights, run } = recorder();
    run(10, [pass(10, 2, 4)]);
    run(30, [pass(30, 7, 9)]);
    run(50, [pass(50, 1, 4), pass(51, 9)]);
    run(80);
    const story = highlights.story(10);
    expect(
      story.map((clip) => [clip.car, clip.passes.map((p) => p.position)]),
    ).toEqual([
      [4, [2]],
      [4, [1]],
      [0, [9]],
    ]);
    const lead = story.find((clip) => clip.passes[0]?.position === 1);
    const midfield = story.find((clip) => clip.car === 0);
    expect(lead?.weight).toBeGreaterThan(midfield?.weight ?? Infinity);
  });
});

describe("highlights reel", () => {
  test("starts, incidents and fastest laps are cut once their moment is over and told in race order", () => {
    const { highlights, cuts, run } = recorder();
    highlights.moment({
      time: 0,
      from: -1,
      to: 10,
      detail: "Lights out",
      camera: "heli",
      weight: 9,
    });
    run(5);
    expect(cuts).toEqual([]);
    run(10.2);
    expect(cuts).toEqual([[-1, 10]]);
    run(30, [pass(30, 4)]);
    highlights.moment({
      time: 60,
      from: 52,
      to: 62,
      detail: "Fastest lap",
      camera: "chase",
      weight: 8,
    });
    run(70);
    const story = highlights.story(10);
    expect(story.map((clip) => clip.detail || "pass")).toEqual([
      "Lights out",
      "pass",
      "Fastest lap",
    ]);
    expect(story[2]?.camera).toBe("chase");
  });

  test("a fastest lap on the final lap still makes the highlights, cut where the footage ends", () => {
    const { highlights, cuts, run } = recorder();
    run(58);
    highlights.moment({
      time: 60,
      from: 52,
      to: 62,
      detail: "Fastest lap",
      camera: "chase",
      weight: 8,
    });
    run(60.5);
    expect(highlights.story(10).map((clip) => clip.detail)).toEqual([
      "Fastest lap",
    ]);
    expect(cuts).toEqual([[52, 60.5]]);
  });

  test("a flashback drops moments that have not happened yet", () => {
    const { highlights, run } = recorder();
    highlights.moment({
      time: 20,
      from: 16,
      to: 24,
      detail: "Contact with Ruiz",
      camera: "tv",
      weight: 7,
    });
    run(30);
    highlights.update(18, 0, []);
    expect(highlights.story(10)).toEqual([]);
  });

  test("a long race keeps only the strongest moments", () => {
    const { highlights, run } = recorder();
    [9, 1, 7, 2, 8].forEach((weight, k) => {
      highlights.moment({
        time: 10 + k * 20,
        from: 8 + k * 20,
        to: 12 + k * 20,
        detail: String(weight),
        camera: "tv",
        weight,
      });
    });
    run(200);
    expect(highlights.story(3).map((clip) => clip.detail)).toEqual([
      "9",
      "7",
      "8",
    ]);
  });
});
