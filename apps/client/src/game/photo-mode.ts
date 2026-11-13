import * as THREE from "three/webgpu";
import type { CameraPose } from "./buildup-shots.ts";
import { carField, carStride, frameIndex } from "./frame-layout.ts";
import { putText } from "./hud-dom.ts";

const photoFilters = [
  { id: "none", label: "None", css: "" },
  { id: "mono", label: "Black & White", css: "grayscale(1) contrast(1.15)" },
  { id: "sepia", label: "Sepia", css: "sepia(0.85) contrast(1.05)" },
  { id: "vivid", label: "Vivid", css: "saturate(1.45) contrast(1.1)" },
  {
    id: "cinema",
    label: "Cinematic",
    css: "contrast(1.2) saturate(0.85) sepia(0.15) hue-rotate(-8deg)",
  },
  { id: "cool", label: "Cool", css: "saturate(1.1) hue-rotate(12deg)" },
  { id: "warm", label: "Warm", css: "sepia(0.25) saturate(1.25)" },
] as const;

export interface PhotoLook {
  filter: number;
  exposure: number;
  contrast: number;
  saturation: number;
  vignette: number;
  letterbox: boolean;
}

export interface Orbit {
  yaw: number;
  pitch: number;
  distance: number;
  rise: number;
  roll: number;
  fov: number;
}

const letterboxAspect = 2.39;
const minDistance = 1.6;
const maxDistance = 60;
const minPitch = -0.08;
const maxPitch = 1.45;
const turnRate = 1.2;
const rollRate = 0.6;
const fovRate = 22;
const zoomRate = 1.6;

function lookFilter(look: PhotoLook): string {
  const preset = photoFilters[look.filter]?.css ?? "";
  const tone = `brightness(${look.exposure.toFixed(2)}) contrast(${look.contrast.toFixed(2)}) saturate(${look.saturation.toFixed(2)})`;
  return `${tone} ${preset}`.trim();
}

function letterboxCrop(
  width: number,
  height: number,
  on: boolean,
): { y: number; height: number } {
  if (!on) return { y: 0, height };
  const crop = Math.min(height, Math.round(width / letterboxAspect));
  return { y: Math.round((height - crop) / 2), height: crop };
}

function orbitPose(
  centre: THREE.Vector3,
  heading: number,
  orbit: Orbit,
): CameraPose {
  const yaw = heading + Math.PI + orbit.yaw;
  const flat = Math.cos(orbit.pitch) * orbit.distance;
  const target: [number, number, number] = [
    centre.x,
    centre.y,
    centre.z + orbit.rise,
  ];
  return {
    eye: [
      target[0] + Math.cos(yaw) * flat,
      target[1] + Math.sin(yaw) * flat,
      target[2] + Math.sin(orbit.pitch) * orbit.distance,
    ],
    target,
    fov: orbit.fov,
    roll: orbit.roll,
  };
}

function photoName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `revracers-${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.png`;
}

export interface PhotoAnchor {
  matrix: THREE.Matrix4;
  label: string;
}

const belowWorld = -100;

function defaultOrbit(): Orbit {
  return { yaw: 0.6, pitch: 0.18, distance: 7, rise: 0.6, roll: 0, fov: 40 };
}

function defaultLook(): PhotoLook {
  return {
    filter: 0,
    exposure: 1,
    contrast: 1,
    saturation: 1,
    vignette: 0.35,
    letterbox: false,
  };
}

interface Slider {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  show: (v: number) => string;
}

export interface PhotoHooks {
  draw: () => void;
  close: () => void;
  names: string[];
}

export class PhotoMode {
  private open = false;
  private frame = new Float64Array(frameIndex.size);
  private cars = new Float64Array(0);
  private target = 0;
  private anchor: PhotoAnchor | null = null;
  private readonly orbit = defaultOrbit();
  private readonly look = defaultLook();
  private readonly held = new Set<string>();
  private lastWall = 0;
  private drag: { x: number; y: number } | null = null;
  private readonly centre = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly values = new Map<string, HTMLElement>();
  private readonly inputs = new Map<string, HTMLInputElement>();
  private readonly vignette: HTMLElement;
  private readonly bars: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: PhotoHooks,
  ) {
    root.innerHTML = `
      <div class="photo-vignette" data-photo="vignette"></div>
      <div class="photo-bars" data-photo="bars"><i></i><i></i></div>
      <div class="photo-flash" data-photo="flash"></div>
      <section class="photo-panel" data-photo="panel">
        <header><b>Photo Mode</b><span data-photo="car"></span></header>
        <div class="photo-rows" data-photo="rows"></div>
        <div class="photo-keys">
          <span><kbd>Drag</kbd><kbd>WASD</kbd> Orbit</span>
          <span><kbd>Wheel</kbd> Zoom</span>
          <span><kbd>Q</kbd><kbd>E</kbd> Roll</span>
          <span><kbd>Z</kbd><kbd>X</kbd> Lens</span>
          <span><kbd>Tab</kbd> Car</span>
          <span><kbd>G</kbd> Filter</span>
          <span><kbd>H</kbd> Hide</span>
        </div>
        <p class="photo-saved" data-photo="saved"></p>
        <footer>
          <button type="button" data-photo="reset"><kbd>R</kbd>Reset</button>
          <button type="button" class="primary" data-photo="shoot"><kbd>Enter</kbd>Take Photo</button>
          <button type="button" data-photo="exit"><kbd>Esc</kbd>Exit</button>
        </footer>
      </section>`;
    this.vignette = this.part("vignette");
    this.bars = this.part("bars");
    this.buildRows();
    this.part("shoot").addEventListener("click", () => {
      void this.capture();
    });
    this.part("exit").addEventListener("click", () => {
      this.close();
    });
    this.part("reset").addEventListener("click", () => {
      this.reset();
    });
    root.addEventListener("pointerdown", (event) => {
      if (event.target !== root && !this.isBackdrop(event.target)) return;
      this.drag = { x: event.clientX, y: event.clientY };
    });
    window.addEventListener("pointermove", (event) => {
      if (!this.drag || !this.open) return;
      this.orbit.yaw -= (event.clientX - this.drag.x) * 0.006;
      this.orbit.pitch = THREE.MathUtils.clamp(
        this.orbit.pitch + (event.clientY - this.drag.y) * 0.005,
        minPitch,
        maxPitch,
      );
      this.drag = { x: event.clientX, y: event.clientY };
    });
    window.addEventListener("pointerup", () => {
      this.drag = null;
    });
    root.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.zoom(Math.sign(event.deltaY) * 0.12);
      },
      { passive: false },
    );
    root.hidden = true;
  }

  get active(): boolean {
    return this.open;
  }

  private isBackdrop(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      (target.dataset["photo"] === "vignette" ||
        target.dataset["photo"] === "bars")
    );
  }

  private part(id: string): HTMLElement {
    const node = this.root.querySelector<HTMLElement>(`[data-photo="${id}"]`);
    if (!node) throw new Error(`photo mode is missing ${id}`);
    return node;
  }

  private sliders(): Slider[] {
    const o = this.orbit;
    const l = this.look;
    const deg = (v: number) => `${String(Math.round((v * 180) / Math.PI))}°`;
    const pct = (v: number) => `${String(Math.round(v * 100))}%`;
    return [
      {
        label: "Field of View",
        min: 8,
        max: 100,
        step: 1,
        get: () => o.fov,
        set: (v) => (o.fov = v),
        show: (v) => `${String(Math.round(v))}°`,
      },
      {
        label: "Roll",
        min: -0.6,
        max: 0.6,
        step: 0.01,
        get: () => o.roll,
        set: (v) => (o.roll = v),
        show: deg,
      },
      {
        label: "Height",
        min: -0.4,
        max: 3,
        step: 0.05,
        get: () => o.rise,
        set: (v) => (o.rise = v),
        show: (v) => `${v.toFixed(2)} m`,
      },
      {
        label: "Exposure",
        min: 0.5,
        max: 1.6,
        step: 0.01,
        get: () => l.exposure,
        set: (v) => (l.exposure = v),
        show: pct,
      },
      {
        label: "Contrast",
        min: 0.6,
        max: 1.6,
        step: 0.01,
        get: () => l.contrast,
        set: (v) => (l.contrast = v),
        show: pct,
      },
      {
        label: "Saturation",
        min: 0,
        max: 2,
        step: 0.01,
        get: () => l.saturation,
        set: (v) => (l.saturation = v),
        show: pct,
      },
      {
        label: "Vignette",
        min: 0,
        max: 1,
        step: 0.01,
        get: () => l.vignette,
        set: (v) => (l.vignette = v),
        show: pct,
      },
    ];
  }

  private buildRows(): void {
    const rows = this.part("rows");
    for (const slider of this.sliders()) {
      const row = document.createElement("label");
      row.className = "photo-row";
      const name = document.createElement("span");
      name.textContent = slider.label;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(slider.min);
      input.max = String(slider.max);
      input.step = String(slider.step);
      const value = document.createElement("b");
      input.addEventListener("input", () => {
        slider.set(Number(input.value));
        this.refresh();
      });
      row.append(name, input, value);
      rows.append(row);
      this.values.set(slider.label, value);
      this.inputs.set(slider.label, input);
    }
    rows.append(
      this.choiceRow("Filter", () => {
        this.look.filter = (this.look.filter + 1) % photoFilters.length;
      }),
      this.choiceRow("Letterbox", () => {
        this.look.letterbox = !this.look.letterbox;
      }),
    );
  }

  private choiceRow(label: string, next: () => void): HTMLElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "photo-row choice";
    const name = document.createElement("span");
    name.textContent = label;
    const value = document.createElement("b");
    row.append(name, value);
    row.addEventListener("click", () => {
      next();
      this.refresh();
    });
    this.values.set(label, value);
    return row;
  }

  private refresh(): void {
    for (const slider of this.sliders()) this.refreshSlider(slider);
    const filter = this.values.get("Filter");
    if (filter) putText(filter, photoFilters[this.look.filter]?.label ?? "");
    const box = this.values.get("Letterbox");
    if (box) putText(box, this.look.letterbox ? "2.39 : 1" : "Off");
    this.canvas.style.filter = lookFilter(this.look);
    this.vignette.style.opacity = String(this.look.vignette);
    this.bars.hidden = !this.look.letterbox;
    putText(this.part("car"), this.subject());
  }

  private subject(): string {
    if (this.target < 0) return this.anchor?.label ?? "";
    return this.hooks.names[this.target] ?? "";
  }

  private refreshSlider(slider: Slider): void {
    const value = slider.get();
    const input = this.inputs.get(slider.label);
    if (input && document.activeElement !== input) input.value = String(value);
    const shown = this.values.get(slider.label);
    if (shown) putText(shown, slider.show(value));
  }

  private reset(): void {
    Object.assign(this.orbit, defaultOrbit());
    Object.assign(this.look, defaultLook());
    this.refresh();
  }

  show(
    frame: Float64Array,
    cars: Float64Array,
    target: number,
    wallNow: number,
    anchor: PhotoAnchor | null = null,
  ): void {
    this.frame = Float64Array.from(frame);
    this.cars = Float64Array.from(cars);
    this.anchor = anchor;
    this.target = anchor ? -1 : target;
    this.open = true;
    this.lastWall = wallNow;
    this.held.clear();
    this.part("saved").textContent = "";
    this.root.hidden = false;
    this.root.classList.remove("bare");
    this.refresh();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    this.canvas.style.filter = "";
    this.hooks.close();
  }

  get scene(): { frame: Float64Array; cars: Float64Array } {
    return { frame: this.frame, cars: this.cars };
  }

  private nextCar(): void {
    const count = Math.max(1, this.cars.length / carStride);
    const shown = (car: number) =>
      car === 0
        ? (this.frame[frameIndex.posMat + 14] ?? 0) > belowWorld
        : (this.cars[car * carStride + carField.visible] ?? 0) !== 0;
    const order = [
      ...(this.anchor ? [-1] : []),
      ...Array.from({ length: count }, (_, car) => car).filter(shown),
    ];
    this.target = order[(order.indexOf(this.target) + 1) % order.length] ?? 0;
    this.refresh();
  }

  private zoom(step: number): void {
    this.orbit.distance = THREE.MathUtils.clamp(
      this.orbit.distance * Math.exp(step),
      minDistance,
      maxDistance,
    );
  }

  key(event: KeyboardEvent, down: boolean): void {
    if (event.target instanceof HTMLInputElement && event.key !== "Escape")
      return;
    event.preventDefault();
    const key = event.key.toLowerCase();
    if (down) this.held.add(key);
    else this.held.delete(key);
    if (!down || event.repeat) return;
    const actions: Record<string, () => void> = {
      escape: () => {
        this.close();
      },
      enter: () => {
        void this.capture();
      },
      " ": () => {
        void this.capture();
      },
      tab: () => {
        this.nextCar();
      },
      g: () => {
        this.look.filter = (this.look.filter + 1) % photoFilters.length;
        this.refresh();
      },
      l: () => {
        this.look.letterbox = !this.look.letterbox;
        this.refresh();
      },
      h: () => {
        this.root.classList.toggle("bare");
      },
      r: () => {
        this.reset();
      },
    };
    actions[key]?.();
  }

  private steer(dt: number): void {
    const on = (...keys: string[]) => keys.some((k) => this.held.has(k));
    const axis = (minus: string[], plus: string[]) =>
      (on(...plus) ? 1 : 0) - (on(...minus) ? 1 : 0);
    const o = this.orbit;
    o.yaw += axis(["arrowright", "d"], ["arrowleft", "a"]) * turnRate * dt;
    o.pitch = THREE.MathUtils.clamp(
      o.pitch +
        axis(["arrowdown", "s"], ["arrowup", "w"]) * turnRate * 0.6 * dt,
      minPitch,
      maxPitch,
    );
    o.roll = THREE.MathUtils.clamp(
      o.roll + axis(["q"], ["e"]) * rollRate * dt,
      -0.6,
      0.6,
    );
    o.fov = THREE.MathUtils.clamp(
      o.fov + axis(["z"], ["x"]) * fovRate * dt,
      8,
      100,
    );
    const zoom = axis(["=", "+"], ["-", "_"]);
    if (zoom !== 0) this.zoom(zoom * zoomRate * dt);
    if (this.held.size > 0) this.refresh();
  }

  update(wallNow: number): CameraPose {
    const dt = Math.max(0, Math.min(0.1, wallNow - this.lastWall));
    this.lastWall = wallNow;
    this.steer(dt);
    if (this.anchor && this.target < 0) this.matrix.copy(this.anchor.matrix);
    else if (this.target === 0)
      this.matrix.fromArray(this.frame, frameIndex.posMat);
    else this.matrix.fromArray(this.cars, this.target * carStride);
    this.centre.setFromMatrixPosition(this.matrix);
    const elements = this.matrix.elements;
    const heading = Math.atan2(elements[1], elements[0]);
    return orbitPose(this.centre, heading, this.orbit);
  }

  async capture(): Promise<void> {
    this.hooks.draw();
    const source = this.canvas;
    const crop = letterboxCrop(
      source.width,
      source.height,
      this.look.letterbox,
    );
    const out = document.createElement("canvas");
    out.width = source.width;
    out.height = crop.height;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.filter = lookFilter(this.look);
    ctx.drawImage(source, 0, -crop.y);
    ctx.filter = "none";
    this.paintVignette(ctx, out.width, out.height);
    this.paintMark(ctx, out.width, out.height);
    this.flash();
    const blob = await new Promise<Blob | null>((resolve) => {
      out.toBlob(resolve, "image/png");
    });
    if (!blob) return;
    const name = photoName(new Date());
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(link.href);
    }, 5000);
    this.part("saved").textContent = `Saved ${name}`;
    document.body.dataset["photo"] = name;
  }

  private paintVignette(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    if (this.look.vignette <= 0) return;
    const radius = Math.hypot(width, height) / 2;
    const shade = ctx.createRadialGradient(
      width / 2,
      height / 2,
      radius * 0.45,
      width / 2,
      height / 2,
      radius,
    );
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, `rgba(0,0,0,${String(0.75 * this.look.vignette)})`);
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);
  }

  private paintMark(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const size = Math.round(height * 0.028);
    ctx.font = `italic 800 ${String(size)}px "Saira Variable", sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fillText("REVRACERS", width - size, height - size * 0.8);
  }

  private flash(): void {
    const flash = this.part("flash");
    flash.classList.remove("on");
    void flash.getBoundingClientRect();
    flash.classList.add("on");
  }
}
