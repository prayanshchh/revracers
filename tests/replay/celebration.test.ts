import * as THREE from "three/webgpu";
import { describe, expect, test } from "vitest";
import type { Celebrant } from "../../apps/client/src/game/celebrant.ts";
import {
  type Move,
  sequence,
} from "../../apps/client/src/game/celebration-moves.ts";
import {
  buildOf,
  standing,
  type V3,
} from "../../apps/client/src/game/crew-motion.ts";
import { podiumSettled } from "../../apps/client/src/game/field-timing.ts";
import { Prop } from "../../apps/client/src/game/podium-props.ts";

const frame = 1 / 60;
const body = {} as Celebrant;
const gap = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function run(seconds: number, step: (now: number) => void): void {
  for (let now = 0; now <= seconds; now += frame) step(now);
}

describe("podium celebration", () => {
  test("one hold hands over to the next without the hands letting go in between", () => {
    const weight = { first: 0, second: 0 };
    const hold =
      (which: keyof typeof weight): Move =>
      (_draft, _t, k) => {
        weight[which] = k;
      };
    const routine = sequence([
      { from: 0, to: 2, move: hold("first"), fade: 0.4 },
      { from: 1.9, to: 4, move: hold("second"), fade: 0.5 },
    ]);
    let loosest = 1;
    run(4, (now) => {
      weight.first = 0;
      weight.second = 0;
      routine(standing(buildOf(1), now, 1), now, body);
      const held = 1 - (1 - weight.first) * (1 - weight.second);
      if (now > 0.45 && now < 3.5) loosest = Math.min(loosest, held);
    });
    expect(loosest).toBeGreaterThan(0.99);
  });

  test("a trophy sits still on its stand, rides smoothly in the hands, and settles back where it was", () => {
    const rest: V3 = [1, 2, 3];
    const prop = new Prop(new THREE.Group(), rest, 0.5);
    prop.holder = {
      stage: (p: V3): V3 => [p[0] + 1, p[1] + 2, p[2] + 0.2],
      turnOut: (d: V3): V3 => d,
    } as unknown as Celebrant;
    prop.keys = [
      { at: 1, where: null },
      { at: 2, where: [0.3, 0, 1.2] },
      { at: 4, where: [0.3, 0, 1.2] },
      { at: 5, where: null },
    ];
    let before: V3 = rest;
    let jump = 0;
    const at = new Map<number, V3>();
    run(7.5, (now) => {
      prop.update(now, frame);
      jump = Math.max(jump, gap(prop.at, before));
      before = prop.at;
      at.set(Math.round(now * 10), prop.at);
    });
    expect(gap(at.get(8) ?? [0, 0, 0], rest)).toBe(0);
    expect(gap(at.get(39) ?? [0, 0, 0], [1.3, 2, 1.4])).toBeLessThan(0.01);
    expect(gap(at.get(75) ?? [0, 0, 0], rest)).toBeLessThan(0.002);
    expect(jump).toBeLessThan(0.06);
  });

  test("champagne only sprays once the bottle has been shaken", () => {
    const prop = new Prop(new THREE.Group(), [0, 0, 1], 0.44);
    prop.keys = [
      { at: 1, where: null },
      { at: 2, where: [0.3, 0, 1.15], shake: 0.075 },
      { at: 3.4, where: [0.3, 0, 1.15], shake: 0.075 },
      { at: 3.8, where: [0.36, 0, 1.25], spray: true },
    ];
    expect([0.5, 2.5, 3.6].some((now) => prop.spraying(now))).toBe(false);
    expect(prop.spraying(3.9)).toBe(true);
  });

  test("the podium waits until the top three have taken the flag, not just the player", () => {
    const row = (
      index: number,
      position: number,
      finished: boolean,
      retired = false,
    ) => ({ index, position, finished, retired, disqualified: false });
    const retiredEarly = [
      row(0, 9, false, true),
      row(1, 1, false),
      row(2, 2, false),
      row(3, 3, false),
    ];
    expect(podiumSettled(retiredEarly, false)).toBe(false);
    const thirdStillRacing = [
      row(0, 1, true),
      row(1, 2, true),
      row(2, 3, false),
    ];
    expect(podiumSettled(thirdStillRacing, false)).toBe(false);
    const thirdRetired = [
      row(0, 1, true),
      row(1, 2, true),
      row(2, 3, false, true),
      row(3, 4, true),
    ];
    expect(podiumSettled(thirdRetired, false)).toBe(true);
    expect(podiumSettled(thirdStillRacing, true)).toBe(true);
  });
});
