import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  type SpeedDreams,
  startCircuit,
  wasm,
} from "../support/speed-dreams.ts";

interface GravelEngine extends SpeedDreams {
  _sdCarPlace: (
    index: number,
    distance: number,
    lateral: number,
    speed: number,
  ) => void;
  _sdCarsGravel: (pointer: number, limit: number) => number;
}

const lateralIndex = 54;
const speedIndex = 45;
const fields = 2;
const asphalt = 0;
const grass = 2;
const gravel = 3;
const gravelBed = { distance: 4600, lateral: 45 };
const grassVerge = { distance: 850, lateral: -12.4 };
const paintedRunoff = { distance: 5070, lateral: -21 };
const road = { distance: 3300, lateral: 0 };

async function placed(
  spot: { distance: number; lateral: number },
  speed: number,
) {
  const m = await startCircuit<GravelEngine>();
  m._sdStep(1000);
  const place = (at: { distance: number; lateral: number }, pace: number) => {
    m._sdCarPlace(0, at.distance, at.lateral, pace);
    m._sdStep(1);
  };
  place(spot, speed);
  const memory = m._malloc(4 * fields * 8);
  const frame = () => new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
  const wheels = () => {
    m._sdCarsGravel(memory, 1);
    const v = new Float64Array(m.HEAPF64.buffer, memory, 4 * fields);
    return [0, 1, 2, 3].map((i) => ({
      surface: v[i * fields] ?? -1,
      stones: v[i * fields + 1] ?? -1,
    }));
  };
  const drive = (ticks: number, pace: number, hold: number) => {
    let previous = frame()[lateralIndex] ?? hold;
    for (let t = 0; t < ticks; t++) {
      const lateral = frame()[lateralIndex] ?? hold;
      const drift = (lateral - previous) / 0.002;
      previous = lateral;
      const steer = Math.max(
        -1,
        Math.min(1, (hold - lateral) * 0.05 - drift * 0.03),
      );
      const speed = frame()[speedIndex] ?? 0;
      const throttle = Math.max(0, Math.min(1, (pace - speed) * 0.3));
      m._sdInputAnalog(1, steer, throttle, 0);
      m._sdStep(1);
    }
  };
  return { place, wheels, drive };
}

describe.runIf(existsSync(wasm))("gravel traps in the engine", () => {
  test("wheels in a gravel bed report gravel and pick up stones that shed on the road", async () => {
    const { place, wheels, drive } = await placed(gravelBed, 10);
    drive(300, 0, gravelBed.lateral);
    const inBed = wheels();
    expect(inBed.map((w) => w.surface)).toEqual([
      gravel,
      gravel,
      gravel,
      gravel,
    ]);
    for (const wheel of inBed) expect(wheel.stones).toBeGreaterThan(0.5);
    place(road, 15);
    drive(5000, 15, road.lateral);
    const onRoad = wheels();
    expect(onRoad.map((w) => w.surface)).toEqual([
      asphalt,
      asphalt,
      asphalt,
      asphalt,
    ]);
    for (const wheel of onRoad) expect(wheel.stones).toBeLessThan(0.2);
  }, 60_000);

  test("grass throws debris but painted run-off does not", async () => {
    const verge = await placed(grassVerge, 0);
    verge.drive(50, 0, grassVerge.lateral);
    expect(verge.wheels().map((w) => w.surface)).toEqual([
      grass,
      grass,
      grass,
      grass,
    ]);
    const runoff = await placed(paintedRunoff, 0);
    runoff.drive(50, 0, paintedRunoff.lateral);
    expect(runoff.wheels().map((w) => w.surface)).toEqual([
      asphalt,
      asphalt,
      asphalt,
      asphalt,
    ]);
  }, 60_000);
});
