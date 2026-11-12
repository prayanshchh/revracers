import { describe, expect, test } from "vitest";
import { LapTrace } from "../../apps/client/src/game/laptrace.ts";

const length = 300;
const boundaries = [100, 200];

function drive(
  trace: LapTrace,
  lap: number,
  sectors: [number, number, number],
  closeLap = true,
) {
  const [a, b, c] = sectors;
  let clock = 0;
  for (let distance = 0; distance < length; distance += 10) {
    const pace = distance < 100 ? a / 100 : distance < 200 ? b / 100 : c / 100;
    trace.sample(lap, distance, clock, 0);
    clock += pace * 10;
  }
  return closeLap ? trace.sample(lap + 1, 0, 0, a + b + c) : null;
}

const referenceTrace = Array.from({ length: length + 1 }, (_, m) => m * 0.1);
const reference = {
  trace: referenceTrace,
  sectors: [10, 10, 10],
  fastestSectors: [9, 10, 8],
};

function atEndOfLap(
  trace: LapTrace,
  lap: number,
  sectors: [number, number, number],
) {
  drive(trace, lap, sectors, false);
  return trace.sectors(length - 1);
}

describe("sector deltas against the stored personal best", () => {
  test("a new driver sees purple sectors and no delta", () => {
    const trace = new LapTrace(length, boundaries);
    const state = atEndOfLap(trace, 1, [10, 10, 10]);
    expect(state.status.slice(0, 2)).toEqual(["pb", "pb"]);
    expect(state.deltas.slice(0, 2)).toEqual([null, null]);
  });

  test("the delta is measured against the personal-best lap", () => {
    const trace = new LapTrace(length, boundaries, reference);
    const state = atEndOfLap(trace, 1, [9.5, 10.5, 10]);
    expect(state.deltas[0]).toBeCloseTo(-0.5, 5);
    expect(state.deltas[1]).toBeCloseTo(0.5, 5);
  });

  test("green beats the best lap, purple beats every lap ever driven", () => {
    const trace = new LapTrace(length, boundaries, reference);
    const state = atEndOfLap(trace, 1, [9.5, 10.5, 10]);
    expect(state.status[0]).toBe("faster");
    expect(state.status[1]).toBe("slower");
    const next = new LapTrace(length, boundaries, reference);
    expect(atEndOfLap(next, 1, [8.9, 9.9, 10]).status.slice(0, 2)).toEqual([
      "pb",
      "pb",
    ]);
  });

  test("a sector set earlier this session becomes the personal best to beat", () => {
    const trace = new LapTrace(length, boundaries, reference);
    drive(trace, 1, [9.6, 10.5, 12]);
    expect(atEndOfLap(trace, 2, [9.7, 10.5, 12]).status[0]).toBe("slower");
    const again = new LapTrace(length, boundaries, reference);
    drive(again, 1, [9.6, 10.5, 12]);
    expect(atEndOfLap(again, 2, [9.5, 10.5, 12]).status[0]).toBe("faster");
  });

  test("a first lap that starts up the road from the line never becomes the best", () => {
    const trace = new LapTrace(length, boundaries);
    let clock = 0;
    for (let distance = 60; distance < length; distance += 10) {
      trace.sample(1, distance, clock, 0);
      clock += 1;
    }
    const short = trace.sample(2, 0, 0, clock);
    expect(short?.best).toBe(false);
    expect(short?.sectors[0]).toBe(0);
    expect(trace.bestTime).toBeNull();
    const full = drive(trace, 2, [10, 10, 10]);
    expect(full?.best).toBe(true);
    expect(trace.bestTime).toBeCloseTo(30, 5);
  });

  test("the last sector closes with the lap and adds up", () => {
    const trace = new LapTrace(length, boundaries, reference);
    const result = drive(trace, 1, [9.5, 10.5, 9.75]);
    expect(result?.sectors).toHaveLength(3);
    expect(result?.sectors.reduce((a, b) => a + b, 0)).toBeCloseTo(29.75, 5);
  });

  test("deltas clear when the next lap starts", () => {
    const trace = new LapTrace(length, boundaries, reference);
    drive(trace, 1, [9.5, 10.5, 10]);
    trace.sample(2, 1, 0.1, 29.5);
    expect(trace.sectors(1).deltas).toEqual([null, null, null]);
  });

  test("a stored reference without per-sector bests uses its own sectors", () => {
    const trace = new LapTrace(length, boundaries, {
      trace: referenceTrace,
      sectors: [10, 10, 10],
    });
    const state = atEndOfLap(trace, 1, [9.5, 10.5, 10]);
    expect(state.status.slice(0, 2)).toEqual(["pb", "slower"]);
  });

  test("NaN gaps in a stored trace give no delta instead of a wild number", () => {
    const gappy = [...referenceTrace];
    gappy[50] = Number.NaN;
    const trace = new LapTrace(length, boundaries, {
      trace: gappy,
      sectors: [10, 10, 10],
    });
    trace.sample(1, 0, 0, 0);
    trace.sample(1, 60, 6, 0);
    expect(trace.delta(50, 5)).toBeNull();
    expect(trace.delta(55, 5.2)).toBeCloseTo(-0.3, 5);
  });
});

describe("sector colours against the whole field", () => {
  test("purple only when no car on the grid has gone faster, green for my own best", () => {
    const trace = new LapTrace(length, boundaries, reference);
    trace.setRivals([9.6, 9.0, 9.0]);
    const first = atEndOfLap(trace, 1, [9.5, 10.5, 10]);
    expect(first.status.slice(0, 2)).toEqual(["pb", "faster"]);
    expect(first.deltas[0]).toBeCloseTo(-0.1, 5);
    expect(first.deltas[1]).toBeCloseTo(1.5, 5);
    drive(trace, 1, [9.5, 10.5, 10]);
    trace.setRivals([9.2, 9.0, 9.0]);
    const second = atEndOfLap(trace, 2, [9.4, 10.4, 10]);
    expect(second.status.slice(0, 2)).toEqual(["faster", "faster"]);
    expect(second.deltas[0]).toBeCloseTo(0.2, 5);
    drive(trace, 2, [9.4, 10.4, 10]);
    const third = atEndOfLap(trace, 3, [9.45, 10.6, 10]);
    expect(third.status.slice(0, 2)).toEqual(["slower", "slower"]);
  });

  test("a stored personal best from another session does not count in a race", () => {
    const trace = new LapTrace(length, boundaries, reference);
    trace.setRivals([null, null, null]);
    const state = atEndOfLap(trace, 1, [12, 12, 12]);
    expect(state.status.slice(0, 2)).toEqual(["pb", "pb"]);
    expect(state.deltas.slice(0, 2)).toEqual([null, null]);
  });

  test("a flashback restores the personal bests the sectors were judged against", () => {
    const trace = new LapTrace(length, boundaries);
    trace.setRivals([20, 20, 20]);
    drive(trace, 1, [10, 10, 10]);
    const saved = trace.save();
    drive(trace, 2, [9, 9, 9]);
    trace.load(saved);
    const state = atEndOfLap(trace, 2, [9.5, 10.5, 10]);
    expect(state.status.slice(0, 2)).toEqual(["pb", "slower"]);
  });
});
