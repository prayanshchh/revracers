import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  type RaceSystems,
  startRace,
  statusReader,
} from "../support/race-systems.ts";
import { wasm } from "../support/speed-dreams.ts";

interface Solid extends RaceSystems {
  _sdObstacles: (circles: number, count: number) => void;
}

const noseAhead = 2.7;
const halfWidth = 1;
const body = 0.2;
const parts = 8;

function pose(m: Solid) {
  const frame = new Float64Array(m.HEAPF64.buffer, m._sdFrame(), 88);
  return {
    cos: frame[1] ?? 1,
    sin: frame[2] ?? 0,
    x: frame[13] ?? 0,
    y: frame[14] ?? 0,
    speed: Math.abs(frame[45] ?? 0),
  };
}

async function onTheGrid() {
  const m = (await startRace({ wear: 0 })) as Solid;
  m._sdStep(1000);
  const start = pose(m);
  const memory = m._malloc(3 * 8);
  const stand = (ahead: number, left: number) => {
    new Float64Array(m.HEAPF64.buffer, memory, 3).set([
      start.x + start.cos * ahead - start.sin * left,
      start.y + start.sin * ahead + start.cos * left,
      body,
    ]);
    m._sdObstacles(memory, 1);
  };
  const travelled = () => {
    const now = pose(m);
    return {
      ahead: (now.x - start.x) * start.cos + (now.y - start.y) * start.sin,
      left: -(now.x - start.x) * start.sin + (now.y - start.y) * start.cos,
      speed: now.speed,
    };
  };
  const drive = (seconds: number, each?: () => void) => {
    for (let tick = 0; tick < seconds * 500; tick++) {
      m._sdInputAnalog(1, 0, 1, 0);
      m._sdStep(1);
      each?.();
    }
  };
  const clear = () => {
    m._sdObstacles(memory, 0);
  };
  return { m, stand, travelled, drive, clear };
}

describe.skipIf(!existsSync(wasm))("people in the pit lane are solid", () => {
  test.each([9, 60])(
    "a crew member standing %i m ahead stops the car undamaged and it drives on once he steps aside",
    async (gap) => {
      const { m, stand, travelled, drive, clear } = await onTheGrid();
      const status = statusReader(m);
      stand(gap, 0);
      let furthest = 0;
      drive(6, () => {
        furthest = Math.max(furthest, travelled().ahead);
      });
      expect(furthest).toBeGreaterThan(gap - body - noseAhead - 0.3);
      expect(furthest).toBeLessThan(gap - body - noseAhead + 0.1);
      expect(travelled().speed).toBeLessThan(0.5);
      for (let part = 0; part < parts; part++)
        expect(status().part(part)).toBe(0);
      clear();
      drive(2);
      expect(travelled().ahead).toBeGreaterThan(gap + 4);
    },
  );

  test("a crew member beside the car's path is brushed past, never driven through", async () => {
    const { stand, travelled, drive } = await onTheGrid();
    const gap = 9;
    const inside = 0.25;
    stand(gap, halfWidth - inside + body);
    let closest = Infinity;
    drive(3, () => {
      const at = travelled();
      const along = gap - at.ahead;
      if (Math.abs(along) > noseAhead) return;
      closest = Math.min(closest, halfWidth - inside + body - at.left);
    });
    expect(closest).toBeGreaterThan(halfWidth + body - 0.1);
  });
});
