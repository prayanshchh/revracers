import { expect, test } from "vitest";
import { around, type Hull } from "../../apps/client/src/game/crew-motion.ts";

type Point = [number, number];

const pace = 0.03;
const slack = 0.05;

function local([px, py]: Point, hull: Hull): Point {
  const c = Math.cos(hull.yaw);
  const s = Math.sin(hull.yaw);
  const dx = px - hull.x;
  const dy = py - hull.y;
  return [dx * c + dy * s, -dx * s + dy * c];
}

function inside(point: Point, hull: Hull): boolean {
  const [x, y] = local(point, hull);
  return (
    x > -hull.rear + slack &&
    x < hull.front - slack &&
    Math.abs(y) < hull.half - slack
  );
}

function walk(from: Point, goal: Point, hull: Hull): Point[] {
  const path: Point[] = [from];
  let at = from;
  for (let step = 0; step < 4000; step++) {
    if (Math.hypot(goal[0] - at[0], goal[1] - at[1]) < pace) break;
    const [x, y] = around(at, goal, hull).way;
    const reach = Math.hypot(x - at[0], y - at[1]);
    if (reach < 1e-6) break;
    const stride = Math.min(pace, reach);
    at = [
      at[0] + ((x - at[0]) / reach) * stride,
      at[1] + ((y - at[1]) / reach) * stride,
    ];
    path.push(at);
  }
  return path;
}

function crossing(path: Point[], hull: Hull): number {
  for (let i = 1; i < path.length; i++) {
    const before = local(path[i - 1] ?? [0, 0], hull);
    const after = local(path[i] ?? [0, 0], hull);
    if (before[1] * after[1] <= 0 && before[1] !== after[1]) return after[0];
  }
  return NaN;
}

const arriving: Hull = {
  x: -1.2,
  y: 0.1,
  yaw: 0.06,
  front: 5.4,
  rear: 3.16,
  half: 1.4,
  open: false,
  soft: false,
  hold: false,
};
const parked: Hull = { ...arriving, x: 0, yaw: 0, front: 2.76, open: true };

test("the crew walk round a car, never through it and never across the nose of one that is moving", () => {
  const trips: [Point, Point][] = [
    [
      [1.4, 3.2],
      [1.5, -1.9],
    ],
    [
      [-2.6, 2.4],
      [-2.2, -1.8],
    ],
    [
      [3.4, 2.1],
      [3.3, -2.2],
    ],
  ];
  for (const hull of [arriving, parked])
    for (const [from, goal] of trips) {
      const path = walk(from, goal, hull);
      const end = path.at(-1) ?? from;
      expect(Math.hypot(end[0] - goal[0], end[1] - goal[1])).toBeLessThan(0.1);
      expect(path.filter((point) => inside(point, hull))).toEqual([]);
      const crossed = crossing(path, hull);
      if (hull.open) expect(Math.abs(crossed)).toBeGreaterThan(2.7);
      else expect(crossed).toBeLessThan(-hull.rear);
    }
});

test("a man still on the wrong side of an arriving car waits there instead of chasing its tail", () => {
  const from: Point = [1.4, 3.2];
  const path = walk(from, [1.5, -1.9], { ...arriving, hold: true });
  const end = path.at(-1) ?? from;
  expect(local(end, arriving)[1]).toBeGreaterThanOrEqual(arriving.half);
  expect(path.length * pace).toBeLessThan(2.5);
  expect(path.filter((point) => inside(point, arriving))).toEqual([]);
});

test("someone caught inside a car's path steps straight out to his own side and stays out", () => {
  const from: Point = [0.4, 0.5];
  const goal: Point = [0.6, -2.4];
  const path = walk(from, goal, arriving);
  const out = path.findIndex((point) => !inside(point, arriving));
  expect(out).toBeGreaterThan(0);
  expect(out * pace).toBeLessThan(1.2);
  expect(local(path[out] ?? from, arriving)[1]).toBeGreaterThan(0);
  expect(path.slice(out).filter((point) => inside(point, arriving))).toEqual(
    [],
  );
  const end = path.at(-1) ?? from;
  expect(Math.hypot(end[0] - goal[0], end[1] - goal[1])).toBeLessThan(0.1);
});
