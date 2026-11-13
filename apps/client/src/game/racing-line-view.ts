import * as THREE from "three/webgpu";
import {
  float,
  instancedBufferAttribute,
  mix,
  positionGeometry,
  positionLocal,
  smoothstep,
  uv,
  vec2,
} from "three/tsl";
import {
  cornerMask,
  emptyPlan,
  layTiles,
  planCues,
  wrap,
  type Cue,
  type RacingLineData,
  type RacingLineMode,
  type SpeedProfile,
  type Tile,
} from "./racing-line.ts";

const tileWidth = 1.15;
const tileLength = 1.6;
const lift = 0.05;
const feather = 0.18;
const cruiseOpacity = 0.5;
const cueOpacity = 0.9;
const cruiseShape = [0.56, 1.1];
const liftShape = [1.15, 1.75];
const brakeAcross = 1.9;
const ribbonFrom = 6;
const behind = 4;
const fadeStart = 450;
const fadeEnd = 750;
const planReach = fadeEnd + 150;
const strongBrake = 22;
const green = new THREE.Color("#a6e3a1");
const yellow = new THREE.Color("#f2c230");
const orange = new THREE.Color("#f0832a");
const red = new THREE.Color("#e3302a");

export class RacingLineView {
  readonly root = new THREE.Group();
  private readonly tiles: Tile[];
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly shape: THREE.InstancedBufferAttribute;
  private readonly gaps: number[];
  private readonly along: THREE.InstancedBufferAttribute;
  private readonly across: THREE.InstancedBufferAttribute;
  private readonly visible: boolean[];
  private readonly colour = new THREE.Color();
  private readonly plan: Cue[];
  private readonly shown: boolean;

  constructor(
    readonly data: RacingLineData,
    private readonly profile: SpeedProfile,
    mode: RacingLineMode,
  ) {
    this.plan = emptyPlan(profile.speed.length);
    this.shown = mode !== "off";
    const corners = cornerMask(data, profile);
    this.tiles = layTiles(data, corners);
    this.visible = this.tiles.map((t) => mode === "full" || !!corners[t.index]);
    this.tint = new THREE.InstancedBufferAttribute(
      new Float32Array(this.tiles.length * 4),
      4,
    );
    this.tint.setUsage(THREE.DynamicDrawUsage);
    this.shape = new THREE.InstancedBufferAttribute(
      new Float32Array(this.tiles.length * 3),
      3,
    );
    this.shape.setUsage(THREE.DynamicDrawUsage);
    this.gaps = this.tiles.map((tile, i) => {
      const next = this.tiles[(i + 1) % this.tiles.length] ?? tile;
      return wrap(next.distance - tile.distance, data.length) / tileLength;
    });
    this.along = new THREE.InstancedBufferAttribute(
      new Float32Array(this.tiles.length * 3),
      3,
    );
    this.across = new THREE.InstancedBufferAttribute(
      new Float32Array(this.tiles.length * 3),
      3,
    );
    const geometry = new THREE.PlaneGeometry(tileLength, tileWidth);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(
      geometry,
      this.material(),
      this.tiles.length,
    );
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3(1, 1, 1);
    const position = new THREE.Vector3();
    const axis = new THREE.Vector3();
    this.tiles.forEach((tile, i) => {
      euler.set(0, -tile.heading, tile.pitch, "YZX");
      rotation.setFromEuler(euler);
      position.set(tile.x, tile.y + lift, tile.z);
      mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
      axis.set(1, 0, 0).applyQuaternion(rotation);
      this.along.setXYZ(i, axis.x, axis.y, axis.z);
      axis.set(0, 0, 1).applyQuaternion(rotation);
      this.across.setXYZ(i, axis.x, axis.y, axis.z);
    });
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.visible = mode !== "off";
    this.root.add(mesh);
  }

  private material(): THREE.MeshBasicNodeMaterial {
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 16,
    });
    const tint = instancedBufferAttribute(this.tint, "vec4" as const);
    const shape = instancedBufferAttribute(this.shape, "vec3" as const);
    const edge = vec2(0.5).sub(uv().sub(0.5).abs());
    const soft = smoothstep(
      float(0),
      float(feather),
      mix(edge.x.min(edge.y), edge.y, shape.z),
    );
    const along = instancedBufferAttribute(this.along, "vec3" as const);
    const across = instancedBufferAttribute(this.across, "vec3" as const);
    material.positionNode = positionLocal
      .add(along.mul(positionGeometry.x.mul(shape.x.sub(1))))
      .add(across.mul(positionGeometry.z.mul(shape.y.sub(1))));
    material.colorNode = tint.xyz;
    material.opacityNode = tint.w.mul(soft);
    return material;
  }

  private lookOf(
    cue: Cue | undefined,
    gap: number,
  ): { along: number; across: number; solid: number; opacity: number } {
    const [cruiseAlong = 1, cruiseAcross = 1] = cruiseShape;
    const [liftAlong = 1, liftAcross = 1] = liftShape;
    if (!cue || cue.kind === "accelerate") {
      this.colour.copy(green);
      return {
        along: cruiseAlong,
        across: cruiseAcross,
        solid: 0,
        opacity: cruiseOpacity,
      };
    }
    if (cue.kind === "lift") {
      this.colour.copy(yellow);
      return {
        along: liftAlong,
        across: liftAcross,
        solid: 0,
        opacity: cueOpacity,
      };
    }
    const hard = Math.min(1, cue.decel / strongBrake);
    const joined = Math.min(1, cue.decel / ribbonFrom);
    this.colour.lerpColors(orange, red, hard);
    return {
      along: liftAlong + (Math.max(liftAlong, gap) - liftAlong) * joined,
      across: liftAcross + (brakeAcross - liftAcross) * joined,
      solid: joined,
      opacity: cueOpacity,
    };
  }

  update(carDistance: number, carSpeed: number): void {
    if (!this.shown) return;
    const length = this.data.length;
    planCues(this.plan, this.profile, length, carDistance, carSpeed, planReach);
    const array = this.tint.array as Float32Array;
    const shapes = this.shape.array as Float32Array;
    this.tiles.forEach((tile, i) => {
      const ahead = wrap(tile.distance - carDistance + behind, length) - behind;
      if (ahead <= 0 || ahead >= fadeEnd) {
        array[i * 4 + 3] = 0;
        return;
      }
      const cue = this.plan[tile.index];
      const fade = 1 - THREE.MathUtils.smoothstep(ahead, fadeStart, fadeEnd);
      const look = this.lookOf(cue, this.gaps[i] ?? 1);
      array[i * 4] = this.colour.r;
      array[i * 4 + 1] = this.colour.g;
      array[i * 4 + 2] = this.colour.b;
      array[i * 4 + 3] = this.visible[i] && cue ? look.opacity * fade : 0;
      shapes[i * 3] = look.along;
      shapes[i * 3 + 1] = look.across;
      shapes[i * 3 + 2] = look.solid;
    });
    this.shape.needsUpdate = true;
    this.tint.needsUpdate = true;
  }
}
