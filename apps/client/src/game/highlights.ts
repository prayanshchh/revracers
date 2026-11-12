import type { ReplayTape } from "./replay.ts";
import type { CameraId } from "./replay-camera.ts";

export interface Pass {
  time: number;
  passer: number;
  passed: number;
  position: number;
  lap: number;
}

const before = 5;
const after = 2.5;
const fieldPlaces = 3;

interface Clip {
  from: number;
  to: number;
  car: number;
  passes: Pass[];
  tape: ReplayTape;
}

interface Window {
  from: number;
  to: number;
  car: number;
  passes: Pass[];
}

export interface Moment {
  time: number;
  from: number;
  to: number;
  detail: string;
  camera: CameraId;
  weight: number;
}

export interface StoryClip {
  from: number;
  car: number;
  tape: ReplayTape;
  passes: Pass[];
  detail: string;
  camera: CameraId;
  weight: number;
}

const passWeight = 10;
const fieldPassWeight = 8.5;

function bestPosition(clip: Clip): number {
  return Math.min(...clip.passes.map((pass) => pass.position));
}

export class Highlights {
  private readonly pending = new Map<number, Window>();
  private clips: Clip[] = [];
  private seen = 0;
  private last = -Infinity;
  private moments: Moment[] = [];
  private momentClips: (Moment & { tape: ReplayTape })[] = [];

  constructor(
    private readonly car: number,
    private readonly copy: (from: number, to: number) => ReplayTape,
  ) {}

  get from(): number {
    return this.seen;
  }

  update(time: number, total: number, fresh: Pass[]): void {
    if (time < this.last) this.rewind(time, total);
    this.last = time;
    for (const pass of fresh) {
      this.seen++;
      if (pass.passer === this.car || pass.position <= fieldPlaces)
        this.note(pass);
    }
    for (const [car, open] of this.pending)
      if (time >= open.to) this.flush(car);
    this.cutMoments(time);
  }

  private note(pass: Pass): void {
    const open = this.pending.get(pass.passer);
    if (open && pass.time - before <= open.to) {
      open.to = pass.time + after;
      open.passes.push(pass);
      return;
    }
    this.flush(pass.passer);
    this.pending.set(pass.passer, {
      from: pass.time - before,
      to: pass.time + after,
      car: pass.passer,
      passes: [pass],
    });
  }

  moment(moment: Moment): void {
    this.moments.push(moment);
  }

  private cutMoments(time: number): void {
    const due = this.moments.filter((m) => time >= m.to);
    if (due.length === 0) return;
    this.moments = this.moments.filter((m) => time < m.to);
    for (const moment of due)
      this.momentClips.push({
        ...moment,
        tape: this.copy(moment.from, Math.min(moment.to, this.last)),
      });
  }

  story(count: number): StoryClip[] {
    this.flushAll();
    this.cutMoments(Infinity);
    const passes: StoryClip[] = this.clips.map((clip) => ({
      from: clip.from,
      car: clip.car,
      tape: clip.tape,
      passes: clip.passes,
      detail: "",
      camera: "tv",
      weight:
        (clip.car === this.car ? passWeight : fieldPassWeight) -
        bestPosition(clip) / 4,
    }));
    const moments: StoryClip[] = this.momentClips.map((clip) => ({
      from: clip.from,
      car: this.car,
      tape: clip.tape,
      passes: [],
      detail: clip.detail,
      camera: clip.camera,
      weight: clip.weight,
    }));
    return [...passes, ...moments]
      .sort((a, b) => b.weight - a.weight || a.from - b.from)
      .slice(0, count)
      .sort((a, b) => a.from - b.from);
  }

  private flush(car: number): void {
    const open = this.pending.get(car);
    this.pending.delete(car);
    if (open) this.clips.push({ ...open, tape: this.copy(open.from, open.to) });
  }

  private flushAll(): void {
    for (const car of [...this.pending.keys()]) this.flush(car);
  }

  private rewind(time: number, total: number): void {
    this.seen = Math.min(this.seen, total);
    const kept = (passes: Pass[]) => passes.filter((p) => p.time <= time);
    this.clips = this.clips
      .map((clip) => ({ ...clip, passes: kept(clip.passes) }))
      .filter((clip) => clip.passes.length > 0);
    for (const [car, open] of this.pending) {
      open.passes = kept(open.passes);
      if (open.passes.length === 0) this.pending.delete(car);
    }
    this.moments = this.moments.filter((m) => m.time <= time);
    this.momentClips = this.momentClips.filter((m) => m.time <= time);
  }
}
