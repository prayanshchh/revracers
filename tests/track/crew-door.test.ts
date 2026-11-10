import { expect, test } from "vitest";
import { throughDoor } from "../../apps/client/src/game/crew-motion.ts";

type Point = [number, number];

const wallFront = 7.1;
const doorEdge = 2.97;
const legs = [-3.2, 3.2];
const legHalf = 0.34;
const legSpan: Point = [6.3, 6.9];
const body = 0.25;
const pace = 0.04;

function walk(from: Point, goal: Point): Point[] {
  const path: Point[] = [from];
  let at = from;
  for (let step = 0; step < 4000; step++) {
    const [x, y] = throughDoor(at, goal);
    const reach = Math.hypot(x - at[0], y - at[1]);
    if (Math.hypot(goal[0] - at[0], goal[1] - at[1]) < pace) break;
    at = [
      at[0] + ((x - at[0]) / reach) * pace,
      at[1] + ((y - at[1]) / reach) * pace,
    ];
    path.push(at);
  }
  return path;
}

function blocked([x, y]: Point): boolean {
  const inWall =
    y > wallFront - body &&
    y < wallFront + 0.5 + body &&
    Math.abs(x) > doorEdge - body;
  const inLeg = legs.some(
    (leg) =>
      Math.abs(x - leg) < legHalf + body &&
      y > legSpan[0] - body &&
      y < legSpan[1] + body,
  );
  return inWall || inLeg;
}

test("the crew leave and enter the garage through its door, clear of the wall and the gantry legs", () => {
  const trips: [Point, Point][] = [
    [
      [-2.25, 9.05],
      [-5.3, 1.35],
    ],
    [
      [2.25, 8.56],
      [5.4, 0.3],
    ],
    [
      [0.8, 8],
      [1.6, 1.5],
    ],
  ];
  for (const [home, work] of trips) {
    for (const [from, goal] of [
      [home, work],
      [work, home],
    ] as [Point, Point][]) {
      const path = walk(from, goal);
      const end = path.at(-1) ?? from;
      expect(Math.hypot(end[0] - goal[0], end[1] - goal[1])).toBeLessThan(0.1);
      expect(path.filter(blocked)).toEqual([]);
    }
  }
});
