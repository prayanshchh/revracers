export interface LapResult {
  lap: number;
  time: number;
  sectors: number[];
  best: boolean;
  delta: number | null;
  valid: boolean;
  full: boolean;
}

type SectorStatus = "pb" | "faster" | "slower";

export interface SectorState {
  times: (number | null)[];
  status: (SectorStatus | null)[];
  deltas: (number | null)[];
  active: number;
}

export interface StoredReference {
  trace: ArrayLike<number>;
  sectors: number[];
  fastestSectors?: number[];
}

const lineSlack = 30;

export interface LapTraceState {
  current: Float64Array;
  best: Float64Array | null;
  bestSectors: number[];
  fastestSectors: number[];
  lastDistance: number;
  lap: number;
  sectorTimes: (number | null)[];
  sectorStatus: SectorState["status"];
  sectorDeltas: SectorState["deltas"];
  sessionSectors: (number | null)[];
}

function below(time: number, reference: number | null | undefined): boolean {
  return reference === null || reference === undefined || time < reference;
}

function smallest(...times: (number | null | undefined)[]): number | null {
  const known = times.filter((t): t is number => t !== null && t !== undefined);
  return known.length > 0 ? Math.min(...known) : null;
}

export class LapTrace {
  private current: Float64Array;
  private fromLine = false;
  private best: Float64Array | null;
  private bestSectors: number[];
  private lastDistance = -1;
  private lap = -1;
  private sectorTimes: (number | null)[];
  private sectorStatus: SectorState["status"];
  private sectorDeltas: SectorState["deltas"];
  private readonly fastestSectors: number[];
  private sessionSectors: (number | null)[];
  private rivals: (number | null)[] | null = null;

  constructor(
    length: number,
    readonly boundaries: number[],
    stored: StoredReference | null = null,
  ) {
    this.current = new Float64Array(Math.ceil(length) + 1).fill(Number.NaN);
    this.best = stored ? Float64Array.from(stored.trace) : null;
    this.bestSectors = stored?.sectors ?? [];
    this.fastestSectors = [...(stored?.fastestSectors ?? this.bestSectors)];
    this.sectorTimes = Array.from(
      { length: boundaries.length + 1 },
      () => null,
    );
    this.sectorStatus = this.sectorTimes.map(() => null);
    this.sectorDeltas = this.sectorTimes.map(() => null);
    this.sessionSectors = this.sectorTimes.map(() => null);
  }

  setRivals(rivals: (number | null)[] | null): void {
    this.rivals = rivals;
  }

  get onFullLap(): boolean {
    return this.lap >= 1 && this.fromLine;
  }

  recorded(distance: number): boolean {
    const bin = Math.max(
      0,
      Math.min(this.current.length - 1, Math.floor(distance)),
    );
    return this.lap >= 1 && !Number.isNaN(this.current[bin] ?? Number.NaN);
  }

  save(): LapTraceState {
    return {
      current: this.current.slice(),
      best: this.best ? this.best.slice() : null,
      bestSectors: [...this.bestSectors],
      fastestSectors: [...this.fastestSectors],
      lastDistance: this.lastDistance,
      lap: this.lap,
      sectorTimes: [...this.sectorTimes],
      sectorStatus: [...this.sectorStatus],
      sectorDeltas: [...this.sectorDeltas],
      sessionSectors: [...this.sessionSectors],
    };
  }

  load(state: LapTraceState): void {
    this.current = state.current.slice();
    this.best = state.best ? state.best.slice() : null;
    this.bestSectors = [...state.bestSectors];
    this.fastestSectors.splice(
      0,
      this.fastestSectors.length,
      ...state.fastestSectors,
    );
    this.lastDistance = state.lastDistance;
    this.lap = state.lap;
    this.sectorTimes = [...state.sectorTimes];
    this.sectorStatus = [...state.sectorStatus];
    this.sectorDeltas = [...state.sectorDeltas];
    this.sessionSectors = [...state.sessionSectors];
  }

  get bestTime(): number | null {
    return this.bestLapTime();
  }

  get reference(): { trace: number[]; sectors: number[] } | null {
    return this.best
      ? { trace: Array.from(this.best), sectors: this.bestSectors }
      : null;
  }

  sample(
    lap: number,
    distance: number,
    time: number,
    lastLapTime: number,
    valid = true,
  ): LapResult | null {
    let result: LapResult | null = null;
    if (lap !== this.lap) {
      if (this.lap >= 1 && lap === this.lap + 1 && lastLapTime > 0)
        result = this.finish(this.lap, lastLapTime, valid);
      this.startLap(lap);
    }
    if (lap >= 1) this.record(distance, time);
    return result;
  }

  private startLap(lap: number): void {
    this.lap = lap;
    this.current.fill(Number.NaN);
    this.lastDistance = -1;
    this.fromLine = false;
    this.sectorTimes = this.sectorTimes.map(() => null);
    this.sectorStatus = this.sectorStatus.map(() => null);
    this.sectorDeltas = this.sectorDeltas.map(() => null);
  }

  private record(distance: number, time: number): void {
    const bin = Math.max(
      0,
      Math.min(this.current.length - 1, Math.floor(distance)),
    );
    if (this.lastDistance < 0) {
      this.current[bin] = time;
      this.lastDistance = bin;
      this.fromLine = bin < lineSlack;
      return;
    }
    if (bin <= this.lastDistance || bin - this.lastDistance >= 200) return;
    const from = this.lastDistance + 1;
    const startTime = this.current[this.lastDistance] ?? time;
    for (let i = from; i <= bin; i++)
      this.current[i] =
        startTime +
        ((time - startTime) * (i - this.lastDistance)) /
          (bin - this.lastDistance);
    this.crossSectors(this.lastDistance, bin);
    this.lastDistance = bin;
  }

  delta(distance: number, time: number): number | null {
    if (!this.best || this.lap < 1) return null;
    const bin = Math.max(
      0,
      Math.min(this.best.length - 1, Math.floor(distance)),
    );
    const reference = this.best[bin];
    if (
      reference === undefined ||
      Number.isNaN(reference) ||
      Number.isNaN(this.current[bin] ?? Number.NaN)
    )
      return null;
    return time - reference;
  }

  predicted(distance: number, time: number): number | null {
    const delta = this.delta(distance, time);
    const bestLap = this.bestLapTime();
    return delta === null || bestLap === null ? null : bestLap + delta;
  }

  sectors(distance: number): SectorState {
    const active = this.boundaries.filter((b) => distance >= b).length;
    return {
      times: [...this.sectorTimes],
      status: [...this.sectorStatus],
      deltas: [...this.sectorDeltas],
      active,
    };
  }

  private bestLapTime(): number | null {
    if (this.bestSectors.length === 0) return null;
    return this.bestSectors.reduce((a, b) => a + b, 0);
  }

  private crossSectors(from: number, to: number): void {
    this.boundaries.forEach((boundary, index) => {
      if (index === 0 && !this.fromLine) return;
      if (from >= 0 && from < boundary && to >= boundary)
        this.closeSector(index, this.current[Math.floor(boundary)] ?? 0);
    });
  }

  private references(index: number): {
    personal: number | null;
    overall: number | null;
    delta: number | null;
  } {
    const field = this.rivals !== null;
    const own = field ? null : this.bestSectors[index];
    const personal = smallest(this.sessionSectors[index], own);
    const rival = field ? this.rivals?.[index] : this.fastestSectors[index];
    const overall = smallest(personal, rival);
    return { personal, overall, delta: field ? overall : (own ?? null) };
  }

  private closeSector(index: number, at: number): void {
    const start = index === 0 ? 0 : this.splitAt(index - 1);
    const time = at - start;
    this.sectorTimes[index] = time;
    const { personal, overall, delta } = this.references(index);
    this.sectorDeltas[index] = delta === null ? null : time - delta;
    this.sectorStatus[index] = below(time, overall)
      ? "pb"
      : below(time, personal)
        ? "faster"
        : "slower";
    if (below(time, this.sessionSectors[index]))
      this.sessionSectors[index] = time;
    const fastest = this.fastestSectors[index];
    if (fastest === undefined || time < fastest)
      this.fastestSectors[index] = time;
  }

  private splitAt(index: number): number {
    const boundary = this.boundaries[index] ?? 0;
    return this.current[Math.floor(boundary)] ?? 0;
  }

  private finish(lap: number, lapTime: number, valid: boolean): LapResult {
    const last = this.boundaries.length;
    this.closeSector(last, lapTime);
    const sectors = this.sectorTimes.map((t) => t ?? 0);
    const previous = this.bestLapTime();
    const best =
      this.fromLine && valid && (previous === null || lapTime < previous);
    const delta = previous === null ? null : lapTime - previous;
    if (best && sectors.every((t) => t > 0)) {
      const trace = Float64Array.from(this.current);
      trace[trace.length - 1] = lapTime;
      this.best = trace;
      this.bestSectors = sectors;
    }
    return {
      lap,
      time: lapTime,
      sectors,
      best,
      delta,
      valid,
      full: this.fromLine,
    };
  }
}
