import { describe, expect, test } from "vitest";
import {
  eventAfter,
  eventLead,
  type Marker,
} from "../../apps/client/src/game/replay-markers.ts";

const markers: Marker[] = [
  { time: 40, kind: "gain", label: "P9" },
  { time: 10, kind: "lap", label: "Lap 2" },
  { time: 25, kind: "incident", label: "Contact" },
];

function walk(start: number, step: 1 | -1, count: number): number[] {
  const seen: number[] = [];
  let time = start;
  for (let k = 0; k < count; k++) {
    const next = eventAfter(markers, time, step);
    if (!next) break;
    seen.push(next.time);
    time = next.time - eventLead;
  }
  return seen;
}

describe("replay event jumps", () => {
  test("jumping forward visits every event in order and stops after the last", () => {
    expect(walk(0, 1, 10)).toEqual([10, 25, 40]);
  });

  test("jumping back from the live end walks backwards without sticking on the event just shown", () => {
    expect(walk(60, -1, 10)).toEqual([40, 25, 10]);
  });
});
