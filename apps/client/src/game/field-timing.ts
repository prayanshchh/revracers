const sectorSlots = 4;
export const traceSlots = 129;

interface CarSectors {
  now: number[];
  last: number[];
  best: number[];
}

export interface FieldSectors {
  cars: CarSectors[];
  sessionSectors: number[];
  sessionHolders: number[];
  fastestLap: number;
  fastestCar: number;
  fastestLapNumber: number;
}

export function fieldSectorsSize(cars: number): number {
  return cars * sectorSlots * 3 + sectorSlots * 2 + 3;
}

export function parseFieldSectors(
  values: ArrayLike<number>,
  cars: number,
): FieldSectors {
  const at = (k: number) => values[k] ?? 0;
  const run = (from: number) =>
    Array.from({ length: sectorSlots }, (_, k) => at(from + k));
  const list = Array.from({ length: cars }, (_, i) => {
    const base = i * sectorSlots * 3;
    return {
      now: run(base),
      last: run(base + sectorSlots),
      best: run(base + sectorSlots * 2),
    };
  });
  const tail = cars * sectorSlots * 3;
  return {
    cars: list,
    sessionSectors: run(tail),
    sessionHolders: run(tail + sectorSlots),
    fastestLap: at(tail + sectorSlots * 2),
    fastestCar: at(tail + sectorSlots * 2 + 1),
    fastestLapNumber: at(tail + sectorSlots * 2 + 2),
  };
}

export function rivalBests(
  field: FieldSectors,
  sectors: number,
  player = 0,
): (number | null)[] {
  return Array.from({ length: sectors }, (_, k) => {
    let best = Infinity;
    field.cars.forEach((car, i) => {
      const time = car.best[k] ?? 0;
      if (i !== player && time > 0 && time < best) best = time;
    });
    return Number.isFinite(best) ? best : null;
  });
}

export function traceTime(
  trace: ArrayLike<number>,
  length: number,
  distance: number,
): number {
  const points = trace.length - 1;
  const x = Math.max(0, Math.min(1, distance / length)) * points;
  const low = Math.min(points - 1, Math.floor(x));
  const a = trace[low] ?? 0;
  const b = trace[low + 1] ?? a;
  return a + (b - a) * (x - low);
}

export interface FastestLap {
  car: number;
  time: number;
  lap: number;
}

export function fastestOf(field: FieldSectors): FastestLap | null {
  return field.fastestLap > 0 && field.fastestCar >= 0
    ? {
        car: field.fastestCar,
        time: field.fastestLap,
        lap: field.fastestLapNumber,
      }
    : null;
}

export function newFastest(
  before: FastestLap | null,
  after: FastestLap | null,
): FastestLap | null {
  if (!after) return null;
  if (!before) return after;
  return after.time < before.time - 1e-9 ? after : null;
}

interface Classified {
  position: number;
  finished: boolean;
  retired: boolean;
  disqualified: boolean;
}

export function podiumSettled(timing: Classified[], over: boolean): boolean {
  if (over) return true;
  return timing
    .filter((row) => !row.retired && !row.disqualified)
    .sort((a, b) => a.position - b.position)
    .slice(0, 3)
    .every((row) => row.finished);
}
