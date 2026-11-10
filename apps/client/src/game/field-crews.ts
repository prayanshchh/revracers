import * as THREE from "three/webgpu";
import { newLook } from "./car-damage.ts";
import type { FieldCars } from "./field-cars.ts";
import { aiPit, aiPitPhase, carStride, pitStateSize } from "./frame-layout.ts";
import { crewKit, type PitCrew } from "./pit-crew.ts";
import type { ParkedBoxes } from "./pit-props.ts";
import { planTimed, type StopPlan } from "./pit-service.ts";
import type { PitPhase } from "./pitstop.ts";

type Point = (distance: number, lateral: number) => [number, number, number];

interface Duty {
  crew: PitCrew;
  car: number;
  box: number;
  plan: StopPlan | null;
  ready: boolean;
}

interface Sight {
  intersectsSphere(sphere: THREE.Sphere): boolean;
}

const crewReach = 9;
const keptKits = 4;
const resting = [false, false, false, false];

export class FieldCrews {
  private readonly duties: Duty[];
  private readonly kits = new Map<string, Promise<THREE.Texture>>();
  private readonly carMatrix = new THREE.Matrix4();
  private readonly bounds = new THREE.Sphere(new THREE.Vector3(), crewReach);
  private point: Point | null = null;
  private lateral = 0;
  private parked: ParkedBoxes | null = null;

  constructor(
    crews: PitCrew[],
    private readonly field: FieldCars,
    private readonly anisotropy: number,
  ) {
    this.duties = crews.map((crew) => ({
      crew,
      car: -1,
      box: 0,
      plan: null,
      ready: false,
    }));
  }

  get roots(): THREE.Object3D[] {
    return this.duties.map((duty) => duty.crew.root);
  }

  park(parked: ParkedBoxes): void {
    this.parked = parked;
  }

  place(point: Point, lateral: number): void {
    this.point = point;
    this.lateral = lateral;
  }

  update(
    pits: Float64Array,
    cars: Float64Array,
    eye: THREE.Vector3,
    now: number,
  ): void {
    this.assign(pits);
    for (const duty of this.duties)
      if (duty.car >= 0) this.serve(duty, pits, cars, eye, now);
  }

  private state(pits: Float64Array, car: number, field: number): number {
    return pits[car * pitStateSize + field] ?? 0;
  }

  private wanted(pits: Float64Array, car: number): boolean {
    const phase = this.state(pits, car, aiPit.phase);
    return (
      (phase === aiPitPhase.lane || phase === aiPitPhase.boxing) &&
      this.state(pits, car, aiPit.noService) === 0 &&
      this.state(pits, car, aiPit.autoRelease) === 1 &&
      !this.duties.some((duty) => duty.car === car)
    );
  }

  private assign(pits: Float64Array): void {
    const count = Math.floor(pits.length / pitStateSize);
    for (let car = 1; car < count; car++) {
      if (!this.wanted(pits, car)) continue;
      const duty = this.duties.find((d) => d.car < 0);
      if (!duty) return;
      this.take(duty, car, this.state(pits, car, aiPit.box));
    }
  }

  private take(duty: Duty, car: number, box: number): void {
    const team = this.field.teamOf(car);
    const mounts = this.field.crewMounts(car);
    if (!team || !mounts || !this.point) return;
    const [x, y, z] = this.point(box, this.lateral);
    const [x2, y2] = this.point(box + 2, this.lateral);
    duty.car = car;
    duty.box = box;
    this.parked?.show(box, false);
    duty.plan = null;
    duty.ready = false;
    duty.crew.setAnchor(x, y, z, Math.atan2(y2 - y, x2 - x));
    duty.crew.attachCar(mounts, null, this.field.damageOf(car) ?? newLook());
    void this.kit(team).then((kit) => {
      if (duty.car !== car) return;
      duty.crew.useTeam(team, kit);
      duty.ready = true;
    });
  }

  private kit(team: string): Promise<THREE.Texture> {
    const known = this.kits.get(team);
    if (known) {
      this.kits.delete(team);
      this.kits.set(team, known);
      return known;
    }
    const loading = crewKit(team, this.anisotropy);
    this.kits.set(team, loading);
    if (this.kits.size > keptKits) {
      const [oldest] = this.kits.keys();
      const stale = oldest === undefined ? undefined : this.kits.get(oldest);
      const inUse = this.duties.some(
        (duty) => duty.car >= 0 && this.field.teamOf(duty.car) === oldest,
      );
      if (oldest !== undefined && stale && !inUse) {
        this.kits.delete(oldest);
        void stale.then((texture) => {
          texture.dispose();
        });
      }
    }
    return loading;
  }

  private phase(pits: Float64Array, car: number): PitPhase {
    const phase = this.state(pits, car, aiPit.phase);
    if (phase === aiPitPhase.stopped) return "service";
    if (phase === aiPitPhase.release) return "release";
    if (phase === aiPitPhase.exit) return "lane";
    if (phase === aiPitPhase.lane || phase === aiPitPhase.boxing)
      return "boxing";
    return "track";
  }

  private serve(
    duty: Duty,
    pits: Float64Array,
    cars: Float64Array,
    eye: THREE.Vector3,
    now: number,
  ): void {
    const phase = duty.ready ? this.phase(pits, duty.car) : "track";
    this.carMatrix.fromArray(cars, duty.car * carStride);
    const result = duty.crew.update(
      phase,
      this.planFor(duty, phase, pits),
      this.state(pits, duty.car, aiPit.elapsed),
      this.carMatrix,
      eye,
      now,
      cars,
      duty.car,
    );
    if (!duty.ready || phase !== "track") {
      this.field.setPitService(
        duty.car,
        result.heave,
        result.pitch,
        result.off,
      );
      return;
    }
    this.field.setPitService(duty.car, 0, 0, resting);
    duty.car = -1;
    this.parked?.show(duty.box, true);
  }

  private planFor(
    duty: Duty,
    phase: PitPhase,
    pits: Float64Array,
  ): StopPlan | null {
    if (phase !== "service") return null;
    duty.plan ??= planTimed(
      this.state(pits, duty.car, aiPit.duration),
      Math.random,
    );
    return duty.plan;
  }

  hideUnseen(sight: Sight, shadows: Sight, warming: boolean): void {
    for (const { crew, car } of this.duties) {
      if (!warming) {
        this.bounds.center.setFromMatrixPosition(crew.root.matrix);
        crew.root.visible =
          car >= 0 &&
          crew.out &&
          (sight.intersectsSphere(this.bounds) ||
            shadows.intersectsSphere(this.bounds));
      }
      if (!crew.root.visible) continue;
      crew.prepare();
      crew.root.updateMatrixWorld();
    }
  }

  warm(): void {
    for (const { crew } of this.duties) crew.warm();
  }

  posts(out: number[]): void {
    for (const { crew, car } of this.duties) if (car >= 0) crew.posts(out);
  }
}
