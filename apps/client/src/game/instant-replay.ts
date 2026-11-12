import type { Engine } from "./engine.ts";
import { carStride, frameIndex } from "./frame-layout.ts";
import { HeapHistory } from "./flashback.ts";
import { Highlights, type Moment, type Pass } from "./highlights.ts";
import type { Hud } from "./hud.ts";
import type { LapTrace, LapTraceState } from "./laptrace.ts";
import { ReplayTape } from "./replay.ts";
import { type Station, trackStations } from "./replay-camera.ts";
import type { Marker, MarkerKind } from "./replay-markers.ts";
import { ReplayView } from "./replay-view.ts";
import type { Scene } from "./scene.ts";
import { type ReelHeader, type ReelShot, VictoryReel } from "./victory-reel.ts";

const finishSeconds = 7;
const storyClips = 10;
const markerLimit = 200;

interface Rewind {
  trace: LapTraceState;
  laps: number;
}

export interface InstantReplayContext {
  engine: Engine;
  scene: Scene;
  hud: Hud;
  trace: LapTrace;
  root: HTMLElement;
  reelRoot: HTMLElement;
  hidden: HTMLElement[];
  names: string[];
  totalLaps: number | null;
  onTrack: () => boolean;
  mute: (muted: boolean) => void;
  photo: (frame: Float64Array, cars: Float64Array, target: number) => void;
}

export class InstantReplay {
  readonly tape: ReplayTape;
  readonly stations: Station[];
  private readonly history: HeapHistory<Rewind>;
  private readonly view: ReplayView;
  private readonly highlights: Highlights;
  private readonly reel: VictoryReel;
  private simTime = -Infinity;
  private markers: Marker[] = [];
  private lap = -1;
  private started = false;

  constructor(private readonly ctx: InstantReplayContext) {
    const { engine } = ctx;
    engine.cars();
    engine.carsDamage();
    engine.carsTyres();
    engine.passes(0);
    engine.fieldSectors();
    this.tape = new ReplayTape(engine.carCount);
    this.history = new HeapHistory(() => engine.heap());
    this.highlights = new Highlights(0, (from, to) => this.tape.copy(from, to));
    const length = engine.trackLength();
    const point = (d: number, l: number) =>
      engine.trackPoint(((d % length) + length) % length, l);
    const stations = trackStations(length, point, (d, side) => {
      const [x, y] = point(d, 0);
      const barrier = engine.barriers(x, y);
      const k = side > 0 ? 0 : 4;
      return (barrier[k + 3] ?? -1) < 0 ? Infinity : (barrier[k] ?? Infinity);
    });
    this.stations = stations;
    this.reel = new VictoryReel(
      ctx.reelRoot,
      stations,
      length,
      engine.carCount,
    );
    this.view = new ReplayView(
      ctx.root,
      this.tape,
      stations,
      length,
      ctx.names,
      {
        flashbackRange: () => this.range(),
        flashback: (time) => this.flashback(time),
        resume: () => {
          this.leave();
        },
        lapAt: (lap) => this.lapLabel(lap),
        markers: () => this.markers,
        photo: () => {
          this.view.setHidden(true);
          ctx.photo(this.view.frame, this.view.cars, this.view.target);
        },
      },
    );
  }

  get active(): boolean {
    return this.view.active || this.reel.active;
  }

  get viewing(): boolean {
    return this.view.active;
  }

  photoClosed(): void {
    this.view.setHidden(false);
  }

  private mark(time: number, kind: MarkerKind, label: string): void {
    this.markers.push({ time, kind, label });
    if (this.markers.length > markerLimit) this.markers.shift();
  }

  record(frame: Float64Array, cars: Float64Array | null): void {
    const time = frame[frameIndex.time] ?? 0;
    const dt = Number.isFinite(this.simTime)
      ? Math.max(0, time - this.simTime)
      : 0;
    this.simTime = time;
    const { engine, trace, hud } = this.ctx;
    this.tape.record(frame, cars ?? engine.cars());
    const { total, list } = engine.passes(this.highlights.from);
    this.markPasses(list);
    this.highlights.update(time, total, list);
    this.watchLaps(frame, time);
    this.history.tick(
      time,
      dt,
      () => ({ trace: trace.save(), laps: hud.laps.length }),
      this.ctx.onTrack(),
    );
  }

  private watchLaps(frame: Float64Array, time: number): void {
    if (!this.started && time > 0 && this.ctx.totalLaps !== null) {
      this.started = true;
      this.moment(0, -1.5, 9, "Lights out and away we go", "heli", 9);
    }
    const lap = frame[frameIndex.laps] ?? 0;
    if (lap !== this.lap && this.lap >= 0 && lap > 1)
      this.mark(time, "lap", this.lapLabel(lap));
    this.lap = lap;
  }

  private markPasses(list: Pass[]): void {
    for (const pass of list) {
      if (pass.passer === 0)
        this.mark(
          pass.time,
          "gain",
          `P${String(pass.position)} - passed ${this.ctx.names[pass.passed] ?? ""}`,
        );
      else if (pass.passed === 0)
        this.mark(
          pass.time,
          "loss",
          `P${String(pass.position + 1)} - ${this.ctx.names[pass.passer] ?? ""} got by`,
        );
    }
  }

  private moment(
    time: number,
    before: number,
    after: number,
    detail: string,
    camera: Moment["camera"],
    weight: number,
  ): void {
    this.highlights.moment({
      time,
      from: time + before,
      to: time + after,
      detail,
      camera,
      weight,
    });
  }

  incident(time: number, detail: string): void {
    this.mark(time, "incident", detail);
    this.moment(time, -4, 5, detail, "tv", 7);
  }

  pitStop(time: number, detail: string): void {
    this.mark(time, "pit", detail);
    this.moment(time, -3, 6, detail, "chase", 4);
  }

  fastestLap(time: number, detail: string): void {
    this.mark(time, "fastest", detail);
    this.moment(time, -7, 2, detail, "chase", 8);
  }

  open(now: number): void {
    if (this.view.active || !this.view.show(now)) return;
    this.ctx.mute(true);
    for (const node of this.ctx.hidden) node.hidden = true;
  }

  jumpBack(time: number): boolean {
    return !this.view.active && this.flashback(time);
  }

  key(event: KeyboardEvent, down: boolean): void {
    if (this.reel.active) this.reel.key(event, down);
    else this.view.key(event, down);
  }

  frame(now: number): void {
    const source = this.reel.active ? this.reel : this.view;
    const pose = source.update(now);
    if (!pose) return;
    const { scene } = this.ctx;
    scene.setCinematic(pose);
    scene.update(source.frame);
    scene.updateField(source.cars);
  }

  highlightsReel(header: ReelHeader, done: () => void): boolean {
    const shots: ReelShot[] = this.highlights.story(storyClips).map((clip) => ({
      tape: clip.tape,
      car: clip.car,
      title: this.lapLabel(lapOfClip(clip.tape)),
      detail:
        clip.passes.length > 0 ? this.passCaption(clip.passes) : clip.detail,
      camera: clip.camera,
    }));
    return this.playReel(shots, header, done);
  }

  private playReel(
    shots: ReelShot[],
    header: ReelHeader,
    done: () => void,
  ): boolean {
    shots.push({
      tape: this.tape.copy(this.tape.end - finishSeconds, this.tape.end),
      title: this.lapLabel(this.ctx.totalLaps ?? 1),
      detail: "Takes the chequered flag",
      camera: "chase",
      car: 0,
    });
    const { scene } = this.ctx;
    const started = this.reel.play(
      shots,
      header,
      performance.now() / 1000,
      () => {
        scene.atmosphere.detail = false;
        scene.setCinematic(null);
        for (const node of this.ctx.hidden) node.hidden = false;
        done();
      },
    );
    if (!started) return false;
    scene.atmosphere.detail = true;
    for (const node of this.ctx.hidden) node.hidden = true;
    return true;
  }

  private passCaption(passes: Pass[]): string {
    const { names } = this.ctx;
    const who = [...new Set(passes.map((pass) => names[pass.passed] ?? ""))];
    const passed =
      who.length > 2 ? `${String(who.length)} cars` : who.join(" and ");
    const position = Math.min(...passes.map((pass) => pass.position));
    const passer = passes[0]?.passer ?? 0;
    const lead = position === 1;
    if (passer === 0)
      return lead
        ? `Takes the lead from ${passed}`
        : `Passes ${passed} for P${String(position)}`;
    const name = names[passer] ?? "";
    return lead
      ? `${name} takes the lead from ${passed}`
      : `${name} passes ${passed} for P${String(position)}`;
  }

  private range(): [number, number] | null {
    if (!this.ctx.onTrack()) return null;
    const usable = this.history.usable();
    const first = usable[0];
    const last = usable[usable.length - 1];
    return first && last ? [first.time, last.time] : null;
  }

  private flashback(time: number): boolean {
    if (!this.ctx.onTrack()) return false;
    const moment = this.history.rewind(time, this.simTime);
    if (!moment) return false;
    const rewound = this.simTime - moment.time;
    const { trace, hud } = this.ctx;
    trace.load(moment.extra.trace);
    hud.rewindLaps(moment.extra.laps);
    this.tape.cut(moment.time);
    this.markers = this.markers.filter((m) => m.time <= moment.time);
    this.ctx.scene.cutDebris(moment.time);
    this.simTime = moment.time;
    this.leave();
    hud.notify(
      "Flashback",
      `Rewound ${rewound.toFixed(1)} s`,
      performance.now() / 1000,
    );
    return true;
  }

  private leave(): void {
    const { engine, scene } = this.ctx;
    engine.resync(performance.now() / 1000);
    scene.setCinematic(null);
    for (const node of this.ctx.hidden) node.hidden = false;
    this.ctx.mute(false);
  }

  private lapLabel(lap: number): string {
    const total = this.ctx.totalLaps;
    const shown = Math.max(1, total ? Math.min(lap, total) : lap);
    return total
      ? `Lap ${String(shown)} / ${String(total)}`
      : `Lap ${String(shown)}`;
  }
}

function lapOfClip(tape: ReplayTape): number {
  const frame = new Float64Array(frameIndex.size);
  const cars = new Float64Array(tape.carCount * carStride);
  return tape.sample(tape.end, frame, cars) ? (frame[frameIndex.laps] ?? 1) : 1;
}
