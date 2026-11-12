import type { CameraPose } from "./buildup-shots.ts";
import { carField, carStride, frameIndex } from "./frame-layout.ts";
import { putData, putStyle, putText } from "./hud-dom.ts";
import type { ReplayTape } from "./replay.ts";
import { ReplayCamera, type Station } from "./replay-camera.ts";
import { eventAfter, eventLead, type Marker } from "./replay-markers.ts";

const openBefore = 8;
const shuttle = 4;
const frameStep = 1 / 30;
const speeds = [1, 0.5, 0.25, 0.1, 2];
const repeatable = new Set([",", "."]);

export interface ReplayHooks {
  flashbackRange(): [number, number] | null;
  flashback(time: number): boolean;
  resume(): void;
  lapAt(lap: number): string;
  markers(): Marker[];
  photo(): void;
}

function speedLabel(rate: number): string {
  if (rate === 0.5) return "½×";
  if (rate === 0.25) return "¼×";
  return `${String(rate)}×`;
}

export class ReplayView {
  private time = 0;
  private playing = true;
  private speed = 0;
  private hold = 0;
  private lastWall = 0;
  private open = false;
  private markersShown = "";
  readonly frame = new Float64Array(frameIndex.size);
  readonly cars: Float64Array;
  private readonly parts: Record<string, HTMLElement> = {};
  private readonly view: ReplayCamera;

  constructor(
    private readonly root: HTMLElement,
    private readonly tape: ReplayTape,
    stations: Station[],
    trackLength: number,
    private readonly names: string[],
    private readonly hooks: ReplayHooks,
  ) {
    this.cars = new Float64Array(tape.carCount * carStride);
    this.view = new ReplayCamera(stations, trackLength);
    root.innerHTML = `
      <div class="replay-badge"><i></i>Replay</div>
      <div class="replay-tag"><b data-replay="lap"></b><span data-replay="ago"></span></div>
      <div class="replay-bar">
        <div class="replay-track" data-replay="track">
          <div class="replay-zone" data-replay="zone"></div>
          <div class="replay-fill" data-replay="fill"></div>
          <div class="replay-marks" data-replay="marks"></div>
          <div class="replay-head" data-replay="head"></div>
        </div>
        <div class="replay-legend"><span data-kind="gain">Overtake</span><span data-kind="loss">Lost place</span><span data-kind="incident">Incident</span><span data-kind="pit">Pit stop</span><span data-kind="fastest">Fastest lap</span><span data-kind="lap">Lap</span></div>
        <div class="replay-controls">
          <button type="button" data-replay="back"><kbd>←</kbd>Rewind</button>
          <button type="button" data-replay="play"><kbd>Space</kbd><span data-replay="play-label">Pause</span></button>
          <button type="button" data-replay="forward"><kbd>→</kbd>Forward</button>
          <button type="button" data-replay="step"><kbd>, .</kbd>Frame</button>
          <button type="button" data-replay="slow"><kbd>S</kbd><span data-replay="speed">1×</span></button>
          <button type="button" data-replay="event"><kbd>[ ]</kbd>Events</button>
          <button type="button" data-replay="camera"><kbd>C</kbd><span data-replay="camera-label"></span></button>
          <button type="button" data-replay="car"><kbd>↑↓</kbd><span data-replay="car-label"></span></button>
          <button type="button" data-replay="photo"><kbd>O</kbd>Photo</button>
          <button type="button" class="flash" data-replay="flash"><kbd>F</kbd>Flashback</button>
          <button type="button" data-replay="exit"><kbd>Esc</kbd>Resume</button>
        </div>
      </div>`;
    root.querySelectorAll<HTMLElement>("[data-replay]").forEach((node) => {
      this.parts[node.dataset["replay"] ?? ""] = node;
    });
    this.bindButtons();
    root.hidden = true;
  }

  get active(): boolean {
    return this.open;
  }

  get rate(): number {
    return speeds[this.speed] ?? 1;
  }

  get target(): number {
    return this.view.target;
  }

  private part(id: string): HTMLElement {
    const node = this.parts[id];
    if (!node) throw new Error(`replay overlay is missing ${id}`);
    return node;
  }

  private bindButtons(): void {
    const click = (id: string, run: () => void) => {
      this.part(id).addEventListener("click", run);
    };
    click("back", () => {
      this.seek(this.time - 5);
    });
    click("forward", () => {
      this.seek(this.time + 5);
    });
    click("play", () => {
      this.playing = !this.playing;
    });
    click("step", () => {
      this.step(1);
    });
    click("slow", () => {
      this.cycleSpeed();
    });
    click("event", () => {
      this.jump(1);
    });
    click("camera", () => {
      this.view.next();
    });
    click("car", () => {
      this.nextCar(1);
    });
    click("photo", () => {
      this.hooks.photo();
    });
    click("flash", () => {
      this.flashback();
    });
    click("exit", () => {
      this.close(true);
    });
    this.part("track").addEventListener("pointerdown", (event) => {
      const box = this.part("track").getBoundingClientRect();
      const share = (event.clientX - box.left) / Math.max(1, box.width);
      this.seek(this.tape.start + share * (this.tape.end - this.tape.start));
    });
  }

  show(wallNow: number): boolean {
    if (this.tape.empty) return false;
    this.open = true;
    this.time = Math.max(this.tape.start, this.tape.end - openBefore);
    this.playing = true;
    this.speed = 0;
    this.hold = 0;
    this.markersShown = "";
    this.view.follow(0);
    this.lastWall = wallNow;
    this.root.hidden = false;
    return true;
  }

  close(resume: boolean): void {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    if (resume) this.hooks.resume();
  }

  setHidden(hidden: boolean): void {
    this.root.hidden = hidden || !this.open;
  }

  private seek(time: number): void {
    this.time = Math.max(this.tape.start, Math.min(this.tape.end, time));
    this.view.cut();
  }

  private step(frames: number): void {
    this.playing = false;
    this.seek(this.time + frames * frameStep);
  }

  private cycleSpeed(): void {
    this.speed = (this.speed + 1) % speeds.length;
  }

  private jump(step: 1 | -1): void {
    const marker = eventAfter(this.hooks.markers(), this.time, step);
    if (marker) {
      this.seek(marker.time - eventLead);
      this.playing = true;
    }
  }

  private nextCar(step: number): void {
    const count = this.tape.carCount;
    for (let k = 1; k <= count; k++) {
      const candidate = (this.view.target + step * k + count * k) % count;
      if ((this.cars[candidate * carStride + carField.visible] ?? 0) !== 0) {
        this.view.follow(candidate);
        return;
      }
    }
  }

  private flashback(): void {
    if (this.hooks.flashback(this.time)) this.close(false);
  }

  key(event: KeyboardEvent, down: boolean): void {
    event.preventDefault();
    const key = event.key.toLowerCase();
    if (key === "arrowleft" || key === "arrowright") {
      const sign = key === "arrowleft" ? -1 : 1;
      this.hold = down ? sign : this.hold === sign ? 0 : this.hold;
      return;
    }
    if (!down || (event.repeat && !repeatable.has(key))) return;
    this.actions()[key]?.();
  }

  private actions(): Record<string, () => void> {
    return {
      " ": () => {
        this.playing = !this.playing;
      },
      s: () => {
        this.cycleSpeed();
      },
      ",": () => {
        this.step(-1);
      },
      ".": () => {
        this.step(1);
      },
      "[": () => {
        this.jump(-1);
      },
      "]": () => {
        this.jump(1);
      },
      c: () => {
        this.view.next();
      },
      arrowup: () => {
        this.nextCar(-1);
      },
      arrowdown: () => {
        this.nextCar(1);
      },
      o: () => {
        this.hooks.photo();
      },
      f: () => {
        this.flashback();
      },
      escape: () => {
        this.close(true);
      },
      r: () => {
        this.close(true);
      },
    };
  }

  sample(): boolean {
    return this.tape.sample(this.time, this.frame, this.cars);
  }

  pose(): CameraPose {
    return this.view.pose(this.frame, this.cars);
  }

  update(wallNow: number): CameraPose | null {
    const dt = Math.max(0, Math.min(0.1, wallNow - this.lastWall));
    this.lastWall = wallNow;
    const rate = this.hold !== 0 ? this.hold * shuttle : this.playing ? 1 : 0;
    this.time += dt * rate * (this.hold === 0 ? this.rate : 1);
    if (this.time >= this.tape.end) {
      this.time = this.tape.end;
      if (this.hold === 0) this.playing = false;
    }
    this.time = Math.max(this.tape.start, this.time);
    if (!this.sample()) return null;
    this.updateOverlay();
    return this.pose();
  }

  private updateOverlay(): void {
    this.updateTimeline();
    this.updateMarkers();
    putText(
      this.part("lap"),
      this.hooks.lapAt(this.frame[frameIndex.laps] ?? 0),
    );
    const ago = this.tape.end - this.time;
    putText(this.part("ago"), ago < 0.05 ? "Live" : `-${ago.toFixed(1)} s`);
    putText(this.part("play-label"), this.playing ? "Pause" : "Play");
    putText(this.part("speed"), speedLabel(this.rate));
    putText(this.part("camera-label"), this.view.label);
    putText(this.part("car-label"), this.names[this.view.target] ?? "");
  }

  private share(t: number): string {
    const span = Math.max(1e-3, this.tape.end - this.tape.start);
    return `${String(((t - this.tape.start) / span) * 100)}%`;
  }

  private updateMarkers(): void {
    const shown = this.hooks
      .markers()
      .filter((m) => m.time >= this.tape.start && m.time <= this.tape.end);
    const key = `${String(this.tape.start)}|${String(this.tape.end)}|${String(shown.length)}`;
    if (key === this.markersShown) return;
    this.markersShown = key;
    this.part("marks").replaceChildren(
      ...shown.map((marker) => {
        const tick = document.createElement("i");
        tick.dataset["kind"] = marker.kind;
        tick.title = marker.label;
        tick.style.left = this.share(marker.time);
        tick.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          this.seek(marker.time - eventLead);
          this.playing = true;
        });
        return tick;
      }),
    );
  }

  private updateTimeline(): void {
    const span = Math.max(1e-3, this.tape.end - this.tape.start);
    putStyle(this.part("head"), "left", this.share(this.time));
    putStyle(this.part("fill"), "width", this.share(this.time));
    const zone = this.hooks.flashbackRange();
    const zoneNode = this.part("zone");
    putStyle(zoneNode, "left", zone ? this.share(zone[0]) : "0%");
    putStyle(
      zoneNode,
      "width",
      zone ? `${String(((zone[1] - zone[0]) / span) * 100)}%` : "0%",
    );
    const canFlash = zone !== null && this.time >= zone[0] - 0.5;
    putData(this.part("flash"), "ready", canFlash ? "yes" : "no");
  }
}
