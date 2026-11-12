import * as THREE from "three/webgpu";
import type { CameraPose } from "./buildup-shots.ts";
import type { Celebrant } from "./celebrant.ts";
import type { V3 } from "./crew-motion.ts";
import type { Engine } from "./engine.ts";
import { carField, carStride, carWheel, frameIndex } from "./frame-layout.ts";
import { putText } from "./hud-dom.ts";
import type { PhotoAnchor } from "./photo-mode.ts";
import { loadCrewModel, Wardrobe } from "./podium-cast.ts";
import { Champagne, Confetti, type Nozzle } from "./podium-effects.ts";
import { Prop } from "./podium-props.ts";
import {
  crowdScript,
  type Driver,
  driverScript,
  type Parc,
  parcCrew,
  parcCrewSpots,
  parcDriver,
  parcLength,
  podiumTimes,
} from "./podium-scripts.ts";
import { buildBarrier, buildStage, steps } from "./podium-stage.ts";
import type { Scene } from "./scene.ts";

export interface PodiumPlace {
  car: number;
  name: string;
  team: string;
  teamId: string;
  colour: string;
  player: boolean;
}

export interface PodiumContext {
  engine: Engine;
  scene: Scene;
  root: HTMLElement;
  rigUrl: string;
  event: string;
}

interface View {
  eye: V3;
  target: V3;
  fov: number;
}

interface Caption {
  label: string;
  name: string;
  detail: string;
}

type Act = "parc" | "podium";

interface Beat {
  length: number;
  view: (t: number) => View;
  caption: Caption | null;
  set: Act;
  confetti?: boolean;
}

const podiumDistance = 150;
const podiumLateral = 3;
const podiumSide = 1;
const carRow = 7.8;
const carSpacing = 4.4;
const stepTop = 0.16;
const rideHeight = 0.3;
const hiddenDepth = 1000;
const trophyLength = 0.48;
const bottleLength = 0.44;
const up = new THREE.Vector3(0, 0, 1);
const confettiColours = ["#ffffff", "#ffd21f", "#e10600"];
const placeLabels = ["Winner", "Second", "Third"];
const crowdRows = [-2.55, -3.25, -3.95, -4.6];
const crowdSize = 14;
const photoCentre: V3 = [0, -1.2, 1.2];
const confettiOver: Record<Act, [THREE.Vector3, [number, number]]> = {
  parc: [new THREE.Vector3(-2.2, -7.9, 0), [4.5, 6]],
  podium: [new THREE.Vector3(0, -0.7, 0), [15, 5]],
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mixVec = (a: V3, b: V3, t: number): V3 => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

function headAt(place: number): number {
  return stepTop + (steps[place]?.height ?? 0) + 1.72;
}

function placeView(place: number, length: number, lift = 0) {
  const x = steps[place]?.x ?? 0;
  const side = x === 0 ? 1 : Math.sign(x);
  const head = headAt(place);
  return (t: number): View => ({
    eye: [x + side * lerp(1.7, 1.1, t / length), -5.0, head - 0.1 + lift],
    target: [x, 0, head - 0.35 + lift],
    fov: 31,
  });
}

function podiumBeats(places: PodiumPlace[], event: string): Beat[] {
  const caption = (k: number): Caption | null => {
    const place = places[k];
    return place
      ? { label: placeLabels[k] ?? "", name: place.name, detail: place.team }
      : null;
  };
  const t = podiumTimes;
  return [
    {
      length: t.third,
      set: "podium",
      view: (s) => ({
        eye: mixVec([-6.5, -14.5, 5.4], [-3.8, -12.4, 4.5], s / t.third),
        target: [0, 0, 2.0],
        fov: 38,
      }),
      caption: { label: "Podium", name: event, detail: "Top three" },
    },
    {
      length: t.second - t.third,
      set: "podium",
      view: placeView(2, t.second - t.third),
      caption: caption(2),
    },
    {
      length: t.winner - t.second,
      set: "podium",
      view: placeView(1, t.winner - t.second),
      caption: caption(1),
    },
    {
      length: t.spray - t.winner,
      set: "podium",
      view: placeView(0, t.spray - t.winner, 0.25),
      caption: caption(0),
      confetti: true,
    },
    {
      length: 3.8,
      set: "podium",
      view: (s) => ({
        eye: mixVec([0, -8.4, 3.3], [0.9, -7.6, 3.1], s / 3.8),
        target: [0, 0, 2.4],
        fov: 40,
      }),
      caption: null,
      confetti: true,
    },
    {
      length: t.end - t.spray - 3.8,
      set: "podium",
      view: (s) => {
        const angle = lerp(-2.1, -1.05, s / (t.end - t.spray - 3.8));
        return {
          eye: [Math.cos(angle) * 9.5, Math.sin(angle) * 9.5, 3.3],
          target: [0, 0, 2.3],
          fov: 40,
        };
      },
      caption: null,
      confetti: true,
    },
  ];
}

function parcBeats(place: PodiumPlace): Beat[] {
  const caption = {
    label: "Race Winner",
    name: place.name,
    detail: place.team,
  };
  return [
    {
      length: 3.6,
      set: "parc",
      view: (t) => ({
        eye: mixVec([3.7, -4.0, 1.7], [3.2, -4.6, 1.6], t / 3.6),
        target: [-0.9, -7.9, 1.2],
        fov: 36,
      }),
      caption,
    },
    {
      length: parcLength - 3.6,
      set: "parc",
      view: (t) => ({
        eye: mixVec(
          [1.4, -4.4, 1.95],
          [1.1, -4.9, 1.85],
          t / (parcLength - 3.6),
        ),
        target: [-1.9, -7.9, 1.45],
        fov: 34,
      }),
      caption,
      confetti: true,
    },
  ];
}

function carPose(
  out: Float64Array,
  at: number,
  forward: THREE.Vector3,
  position: THREE.Vector3,
): void {
  const left = new THREE.Vector3().crossVectors(up, forward);
  const m = new THREE.Matrix4().makeBasis(forward, left, up);
  m.setPosition(position);
  m.toArray(out, at);
}

function release(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh)
      return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials as THREE.Material[]) {
      const map = (material as THREE.MeshStandardMaterial).map;
      if (map instanceof THREE.CanvasTexture) map.dispose();
      material.dispose();
    }
    (object.geometry as THREE.BufferGeometry).dispose();
  });
}

function crowdSpot(i: number): [number, number, number] {
  const row = i % crowdRows.length;
  const column = Math.floor(i / crowdRows.length);
  const x = (column - 1.5) * 2.1 + (row % 2) * 1.05 + Math.sin(i * 2.7) * 0.22;
  const y = (crowdRows[row] ?? -3) + Math.cos(i * 1.9) * 0.12;
  return [x, y, Math.atan2(1.4 - y, -x * 0.35)];
}

export class PodiumCeremony {
  readonly frame = new Float64Array(frameIndex.size);
  readonly cars: Float64Array;
  private model: Promise<THREE.Object3D> | null = null;
  private readonly world = new THREE.Group();
  private readonly toWorld = new THREE.Matrix4();
  private readonly toStage = new THREE.Matrix4();
  private readonly scratch = new THREE.Vector3();
  private readonly across = new THREE.Vector3(1, 0, 0);
  private readonly toCrowd = new THREE.Vector3(0, -1, 0);
  private wardrobe: Wardrobe | null = null;
  private barrier: THREE.Group | null = null;
  private drivers: Driver[] = [];
  private crowd: Celebrant[] = [];
  private parc: Parc | null = null;
  private spray: Champagne | null = null;
  private confetti: Confetti | null = null;
  private beats: Beat[] = [];
  private beat = -1;
  private time = 0;
  private beatStart = 0;
  private podiumStart = 0;
  private lastWall = 0;
  private playing = false;
  private busy = false;
  private rivals: number[] = [];
  private focus = 0;
  private done: () => void = () => undefined;
  private readonly parts: Record<string, HTMLElement> = {};

  constructor(private readonly ctx: PodiumContext) {
    this.cars = new Float64Array(ctx.engine.carCount * carStride);
    this.world.matrixAutoUpdate = false;
    ctx.root.innerHTML = `
      <div class="reel-head"><small data-podium="label"></small><b data-podium="name"></b><span data-podium="detail"></span></div>
      <button type="button" class="reel-skip" data-podium="skip"><kbd>↵</kbd>Skip</button>`;
    ctx.root.querySelectorAll<HTMLElement>("[data-podium]").forEach((node) => {
      this.parts[node.dataset["podium"] ?? ""] = node;
    });
    this.parts["skip"]?.addEventListener("click", () => {
      this.finish();
    });
    ctx.root.hidden = true;
  }

  get active(): boolean {
    return this.playing;
  }

  get focusCar(): number {
    return this.focus;
  }

  get anchor(): PhotoAnchor {
    const into = this.toCrowd.clone().negate();
    const matrix = new THREE.Matrix4()
      .makeBasis(into, new THREE.Vector3().crossVectors(up, into), up)
      .setPosition(this.local(...photoCentre));
    return { matrix, label: "Podium" };
  }

  photoOpened(): void {
    this.ctx.root.hidden = true;
  }

  photoClosed(): void {
    this.ctx.root.hidden = false;
    this.lastWall = performance.now() / 1000;
  }

  private local(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.toWorld);
  }

  private world3(v: V3): V3 {
    return this.local(...v).toArray();
  }

  private bone = (body: Celebrant, name: string): V3 =>
    body.point(name, this.toStage, this.scratch);

  private head = (place: number): V3 => {
    const driver = this.drivers[place];
    return driver ? this.bone(driver.body, "Head") : [0, 0, 2.6];
  };

  private site(): void {
    const { engine } = this.ctx;
    const length = engine.trackLength();
    const at = (d: number) =>
      new THREE.Vector3(
        ...engine.trackPoint((d + length) % length, podiumLateral),
      );
    const origin = at(podiumDistance);
    const forward = at(podiumDistance + 5)
      .sub(at(podiumDistance - 5))
      .setZ(0)
      .normalize();
    const back = new THREE.Vector3()
      .crossVectors(up, forward)
      .multiplyScalar(podiumSide);
    this.across.crossVectors(back, up);
    this.toCrowd.copy(back).negate();
    this.toWorld.makeBasis(this.across, back, up).setPosition(origin);
    this.toStage.copy(this.toWorld).invert();
    this.world.matrix.copy(this.toWorld);
  }

  async play(
    places: PodiumPlace[],
    wallNow: number,
    done: () => void,
  ): Promise<boolean> {
    if (this.playing || this.busy || places.length === 0) return false;
    this.busy = true;
    try {
      this.model ??= loadCrewModel(this.ctx.rigUrl);
      this.wardrobe = await Wardrobe.open(
        this.model,
        places.map((place) => place.teamId),
      );
    } catch {
      return false;
    } finally {
      this.busy = false;
    }
    this.done = done;
    this.playing = true;
    this.focus = places[0]?.car ?? 0;
    this.site();
    this.build(places);
    this.parkCars(places);
    const winner = places[0];
    const parc = winner?.player ? parcBeats(winner) : [];
    this.podiumStart = parc.reduce((sum, beat) => sum + beat.length, 0);
    this.beats = [...parc, ...podiumBeats(places, this.ctx.event)];
    this.ctx.scene.scene.add(this.world);
    this.ctx.root.hidden = false;
    this.lastWall = wallNow;
    this.time = 0;
    this.beatStart = 0;
    this.cue(0);
    return true;
  }

  private build(places: PodiumPlace[]): void {
    const wardrobe = this.wardrobe;
    if (!wardrobe) return;
    const stage = buildStage(this.ctx.event);
    this.spray = new Champagne();
    this.confetti = new Confetti(new THREE.Vector3(0, -1.2, 0), [15, 6.5], 9, [
      ...places.map((p) => p.colour),
      ...confettiColours,
    ]);
    this.world.add(stage.root, this.spray.mesh, this.confetti.mesh);
    this.drivers = places.flatMap((place, k) => {
      const trophy = stage.trophies[k];
      const bottle = stage.bottles[k];
      const top = stage.stands[k];
      const step = steps[k];
      if (!trophy || !bottle || !top || !step) return [];
      const body = wardrobe.figure(place.teamId, 0.7 + k * 3.1);
      body.place(step.x, 0.08, stepTop + step.height, -Math.PI / 2);
      const size = k === 0 ? 1.25 : 1;
      const driver: Driver = {
        body,
        trophy: new Prop(
          trophy,
          [top[0] + 0.06, top[1], top[2]],
          trophyLength * size,
        ),
        bottle: new Prop(
          bottle,
          [top[0] - 0.13, top[1] + 0.03, top[2]],
          bottleLength,
        ),
      };
      this.world.add(body.root, trophy, bottle);
      return [driver];
    });
    this.drivers.forEach((driver, k) => {
      driverScript(k, driver, this.head);
    });
    this.buildCrowd(places);
    if (places[0]?.player) this.buildParc(places[0]);
  }

  private buildCrowd(places: PodiumPlace[]): void {
    const wardrobe = this.wardrobe;
    if (!wardrobe) return;
    this.crowd = Array.from({ length: crowdSize }, (_, i) => {
      const team = i < 8 ? 0 : i < 11 ? 1 : 2;
      const place = places[team] ?? places[0];
      const body = wardrobe.figure(place?.teamId ?? "", 11 + i * 1.37);
      const [x, y, yaw] = crowdSpot(i);
      body.place(x, y, 0, yaw);
      crowdScript(body, places[team] ? team : 0, this.head);
      this.world.add(body.root);
      return body;
    });
  }

  private buildParc(winner: PodiumPlace): void {
    const wardrobe = this.wardrobe;
    if (!wardrobe) return;
    const driver = wardrobe.figure(winner.teamId, 0.7);
    const crew = parcCrewSpots.map(([x, y], j) => {
      const member = wardrobe.figure(winner.teamId, 41 + j * 2.3);
      member.place(x, y, 0, Math.sin(j * 1.7) * 0.12);
      return member;
    });
    driver.place(-0.68, -8.05, 0.72, Math.PI);
    this.parc = { driver, crew };
    parcDriver(this.parc, { bone: this.bone });
    parcCrew(this.parc, { bone: this.bone });
    this.barrier = buildBarrier(winner.colour, [-1.95, -10.3], [-1.95, -5.5]);
    this.world.add(driver.root, ...crew.map((m) => m.root), this.barrier);
  }

  private parkCars(places: PodiumPlace[]): void {
    const { engine } = this.ctx;
    this.frame.set(engine.frame());
    this.cars.set(engine.cars());
    for (let i = 0; i < engine.carCount; i++)
      this.cars[i * carStride + carField.visible] = 0;
    const heading = this.toCrowd.clone().negate();
    this.rivals = [];
    places.forEach((place, k) => {
      const x = [0, -carSpacing, carSpacing][k] ?? 0;
      const spot = this.local(x, -carRow, rideHeight);
      if (place.car === 0) {
        carPose(this.frame, frameIndex.posMat, heading, spot);
        return;
      }
      const at = place.car * carStride;
      if (k > 0) this.rivals.push(at);
      carPose(this.cars, at, heading, spot);
      this.cars[at + carField.visible] = 1;
      this.cars[at + carField.speed] = 0;
      for (let w = 0; w < 4; w++)
        this.cars[at + carWheel.from + w * carWheel.stride + carWheel.yaw] = 0;
    });
    if (!places.some((place) => place.car === 0))
      this.frame[frameIndex.posMat + 14] = -hiddenDepth;
  }

  key(event: KeyboardEvent, down: boolean): void {
    event.preventDefault();
    if (down && !event.repeat && ["Enter", " ", "Escape"].includes(event.key))
      this.finish();
  }

  private cue(index: number): void {
    const beat = this.beats[index];
    if (!beat) {
      this.finish();
      return;
    }
    this.beat = index;
    this.show(beat.set);
    this.confetti?.over(...confettiOver[beat.set]);
    if (beat.confetti) this.confetti?.start();
    const caption = beat.caption;
    this.ctx.root.classList.toggle("bare", caption === null);
    if (!caption) return;
    putText(this.part("label"), caption.label);
    putText(this.part("name"), caption.name);
    putText(this.part("detail"), caption.detail);
  }

  private show(set: Act): void {
    const podium = set === "podium";
    for (const driver of this.drivers) {
      driver.body.root.visible = podium;
      driver.trophy.object.visible = podium;
      driver.bottle.object.visible = podium;
    }
    for (const body of this.crowd) body.root.visible = podium;
    if (this.parc) {
      this.parc.driver.root.visible = !podium;
      for (const member of this.parc.crew) member.root.visible = !podium;
    }
    if (this.barrier) this.barrier.visible = !podium;
    for (const at of this.rivals)
      this.cars[at + carField.visible] = podium ? 1 : 0;
  }

  private part(id: string): HTMLElement {
    const node = this.parts[id];
    if (!node) throw new Error(`podium is missing ${id}`);
    return node;
  }

  update(wallNow: number): CameraPose | null {
    const beat = this.beats[this.beat];
    if (!this.playing || !beat) return null;
    const dt = Math.max(0, Math.min(0.1, wallNow - this.lastWall));
    this.lastWall = wallNow;
    this.time += dt;
    if (this.time - this.beatStart > beat.length) {
      this.beatStart += beat.length;
      this.cue(this.beat + 1);
      return this.update(wallNow);
    }
    if (beat.set === "podium") this.podium(this.time - this.podiumStart, dt);
    else this.parcFerme(this.time, dt);
    this.confetti?.update(dt);
    this.world.updateMatrixWorld(true);
    const view = beat.view(this.time - this.beatStart);
    return {
      eye: this.world3(view.eye),
      target: this.world3(view.target),
      fov: view.fov,
    };
  }

  private podium(now: number, dt: number): void {
    const nozzles: Nozzle[] = [];
    for (const { body, trophy, bottle } of this.drivers) {
      trophy.update(now, dt);
      bottle.update(now, dt);
      body.update(now, dt);
      if (bottle.spraying(now))
        nozzles.push({
          from: new THREE.Vector3(...bottle.tip()),
          direction: new THREE.Vector3(...bottle.axis),
        });
    }
    for (const body of this.crowd) body.update(now, dt);
    this.spray?.update(dt, nozzles);
  }

  private parcFerme(now: number, dt: number): void {
    if (!this.parc) return;
    this.parc.driver.update(now, dt);
    for (const member of this.parc.crew) member.update(now, dt);
  }

  private figures(): Celebrant[] {
    return [
      ...this.drivers.map((driver) => driver.body),
      ...this.crowd,
      ...(this.parc ? [this.parc.driver, ...this.parc.crew] : []),
    ];
  }

  private finish(): void {
    if (!this.playing) return;
    this.playing = false;
    this.ctx.root.hidden = true;
    this.ctx.scene.scene.remove(this.world);
    for (const body of this.figures()) this.world.remove(body.root);
    release(this.world);
    this.wardrobe?.dispose();
    this.wardrobe = null;
    this.world.clear();
    this.drivers = [];
    this.crowd = [];
    this.parc = null;
    this.barrier = null;
    this.beats = [];
    this.ctx.scene.setCinematic(null);
    this.done();
  }
}
