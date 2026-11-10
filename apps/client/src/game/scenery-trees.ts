import * as THREE from "three/webgpu";
import {
  atan,
  dot,
  float,
  floor,
  fract,
  fwidth,
  instancedBufferAttribute,
  mix,
  normalize,
  positionGeometry,
  sin,
  smoothstep,
  step,
  texture,
  time,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import table from "../../../../content/scenery/trees/trees.json";
import { releaseOnceUploaded } from "./preload.ts";
import { alphaTestedOrder, shadowOnlyLayer } from "./road.ts";
import { foliageTint, foliageTurned, foliageTurning } from "./scenery-look.ts";
import { SkyLitMaterial } from "./sky-ambient.ts";

const files = import.meta.glob<string>(
  "../../../../content/scenery/trees/*.webp",
  { query: "?url", import: "default", eager: true },
);

const stride = 8;
const tileSize = 1500;
const turn = Math.PI * 2;
const highRingFrom = Math.sin((22 * Math.PI) / 180);
const frameInset = 0.012;
const alphaCutoff = 0.42;
const shadowCutoff = 0.5;
const roundness = 0.55;
const crownCentre = 0.58;
const crownDepth = 0.7;
const swayRate = 1.1;
const swayReach = 0.012;
const tintSpread = 0.16;
const turnedFloor = 0.45;
const backlight = 0.55;
const backlightFocus = 3;
const foliageRoughness = 0.86;
const shadeFloor = 0.7;
const leafGain = 1.7;
const anisotropyLimit = 4;
const sheetColumns = 2;
const leafGamma = 2.2;

type Species = keyof typeof table.species;
const speciesNames = Object.keys(table.species) as Species[];
const sheetRows = Math.ceil(speciesNames.length / sheetColumns);

function fileUrl(name: string): string {
  const entry = Object.entries(files).find(([key]) => key.endsWith(`/${name}`));
  if (!entry) throw new Error(`missing tree asset ${name}`);
  return entry[1];
}

export function treeDownloads(): string[] {
  return speciesNames.flatMap((name) => [
    fileUrl(`${name}.webp`),
    fileUrl(`${name}-shape.webp`),
  ]);
}

const eyeModel = uniform(new THREE.Vector3());
const sunModel = uniform(new THREE.Vector3(0, 1, 0));
const sunLight = uniform(new THREE.Color(1, 1, 1));
const shadowRing = uniform(1);

interface Instances {
  place: THREE.InstancedBufferAttribute;
  look: THREE.InstancedBufferAttribute;
  frame: THREE.InstancedBufferAttribute;
}

interface Lean {
  sine: THREE.Node<"float">;
  cosine: THREE.Node<"float">;
}

interface View {
  toward: (centre: THREE.Node<"vec3">) => THREE.Node<"vec3">;
  ring: (direction: THREE.Node<"vec3">) => THREE.Node<"float">;
  lean: (ring: THREE.Node<"float">) => Lean;
}

interface Billboard {
  place: THREE.Node<"vec4">;
  look: THREE.Node<"vec4">;
  direction: THREE.Node<"vec3">;
  position: THREE.Node<"vec3">;
  right: THREE.Node<"vec3">;
  up: THREE.Node<"vec3">;
  toward: THREE.Node<"vec3">;
  first: THREE.Node<"vec2">;
  second: THREE.Node<"vec2">;
  blend: THREE.Node<"float">;
  across: THREE.Node<"float">;
  rise: THREE.Node<"float">;
}

function frameUv(
  kind: THREE.Node<"float">,
  index: THREE.Node<"float">,
  across: THREE.Node<"float">,
  rise: THREE.Node<"float">,
): THREE.Node<"vec2"> {
  const column = index.mod(table.columns);
  const row = floor(index.div(table.columns));
  const inSheet = vec2(
    column.add(across.add(0.5)).div(table.columns),
    row.add(float(1).sub(rise)).div(table.rows),
  );
  const cell = vec2(kind.mod(sheetColumns), floor(kind.div(sheetColumns)));
  return cell.add(inSheet).div(vec2(sheetColumns, sheetRows));
}

function billboard(instances: Instances, view: View): Billboard {
  const place = vec4(
    instancedBufferAttribute(instances.place) as ReturnType<typeof vec4>,
  );
  const look = vec4(
    instancedBufferAttribute(instances.look) as ReturnType<typeof vec4>,
  );
  const shape = vec4(
    instancedBufferAttribute(instances.frame) as ReturnType<typeof vec4>,
  );
  const height = place.w;
  const direction = view.toward(place.xyz.add(vec3(0, height.mul(0.5), 0)));
  const level = view.ring(direction);
  const lean = view.lean(level);
  const flat = normalize(vec2(direction.x, direction.z));
  const right = vec3(flat.y, 0, flat.x.negate());
  const outward = vec3(flat.x, 0, flat.y);
  const up = vec3(0, 1, 0).mul(lean.cosine).sub(outward.mul(lean.sine));
  const facing = outward.mul(lean.cosine).add(vec3(0, 1, 0).mul(lean.sine));
  const size = mix(shape.x, shape.y, level);
  const drop = mix(shape.z, shape.w, level);
  const across = positionGeometry.x.clamp(-0.5 + frameInset, 0.5 - frameInset);
  const rise = positionGeometry.y.clamp(frameInset, 1 - frameInset);
  const sway = sin(time.mul(swayRate).add(look.y.mul(40)))
    .mul(swayReach)
    .mul(rise.mul(rise));
  const position = place.xyz
    .add(right.mul(across.add(sway).mul(size).mul(height)))
    .add(up.mul(rise.sub(drop).mul(size).mul(height)));
  const angle = atan(flat.y.negate(), flat.x).sub(look.y.mul(turn));
  const frame = fract(angle.div(turn)).mul(table.azimuths);
  const base = level.mul(table.azimuths);
  const first = floor(frame);
  const second = first.add(1).mod(table.azimuths);
  return {
    place,
    look,
    direction,
    position,
    right,
    up,
    toward: facing,
    first: frameUv(look.x, first.add(base), across, rise),
    second: frameUv(look.x, second.add(base), across, rise),
    blend: fract(frame),
    across,
    rise,
  };
}

function foliage(
  albedo: THREE.Texture,
  form: THREE.Texture,
  instances: Instances,
): THREE.Material {
  const material = new SkyLitMaterial({
    side: THREE.DoubleSide,
    roughness: foliageRoughness,
    metalness: 0,
    alphaTest: alphaCutoff,
    alphaToCoverage: true,
  });
  const [, high = 40] = table.rings;
  const tilt = (high * Math.PI) / 180;
  const quad = billboard(instances, {
    toward: (centre) => eyeModel.sub(centre),
    ring: (direction) =>
      step(highRingFrom, direction.y.div(direction.length())),
    lean: (ring) => ({
      sine: ring.mul(Math.sin(tilt)),
      cosine: mix(float(1), float(Math.cos(tilt)), ring),
    }),
  });
  material.positionNode = quad.position;
  const first = varying(quad.first);
  const second = varying(quad.second);
  const blend = varying(quad.blend);
  const a = texture(albedo, first);
  const b = texture(albedo, second);
  const cover = mix(a.a, b.a, blend);
  const leaf = mix(a.rgb, b.rgb, blend).div(cover.max(1e-3)).pow(leafGamma);
  const edge = fwidth(cover).max(1e-3);
  const alpha = cover.sub(alphaCutoff).div(edge).add(0.5).clamp(0, 1);
  const tint = varying(
    mix(
      vec3(1).sub(vec3(tintSpread, tintSpread * 0.4, tintSpread)),
      vec3(1).add(vec3(tintSpread * 0.6, tintSpread * 0.5, 0)),
      quad.look.z,
    )
      .mul(foliageTint)
      .mul(
        mix(
          vec3(1),
          foliageTurned,
          step(quad.look.w, foliageTurning).mul(
            mix(float(turnedFloor), float(1), quad.look.z),
          ),
        ),
      ),
  );
  const shape = mix(texture(form, first), texture(form, second), blend);
  const right = varying(quad.right);
  const up = varying(quad.up);
  const toward = varying(quad.toward);
  const across = varying(quad.across);
  const rise = varying(quad.rise);
  const slope = shape.xy.mul(2).sub(1);
  const baked = vec3(slope, float(1).sub(slope.dot(slope)).max(0).sqrt());
  const round = normalize(
    vec3(across.mul(2), rise.sub(crownCentre).mul(2), float(crownDepth)),
  );
  const local = normalize(mix(baked, round, roundness));
  const normal = normalize(
    right.mul(local.x).add(up.mul(local.y)).add(toward.mul(local.z)),
  );
  material.normalNode = transformNormalToView(normal);
  const depth = mix(float(shadeFloor), float(1), shape.z);
  const lit = leaf.mul(tint).mul(leafGain);
  material.colorNode = vec4(lit.mul(depth), alpha);
  const view = normalize(varying(quad.direction));
  const through = dot(view.negate(), sunModel)
    .max(0)
    .pow(backlightFocus)
    .mul(backlight)
    .mul(smoothstep(0, 0.25, sunModel.y));
  material.emissiveNode = lit.mul(sunLight).mul(through).mul(0.25);
  return material;
}

function shade(albedo: THREE.Texture, instances: Instances): THREE.Material {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const level = sunModel.y.clamp(0.05, 0.98);
  const quad = billboard(instances, {
    toward: () => sunModel,
    ring: () => shadowRing,
    lean: () => ({
      sine: level,
      cosine: float(1).sub(level.mul(level)).sqrt(),
    }),
  });
  const spread = quad.place.w.mul(quad.look.z);
  material.positionNode = quad.position.sub(sunModel.mul(spread));
  const cover = mix(
    texture(albedo, varying(quad.first)).a,
    texture(albedo, varying(quad.second)).a,
    varying(quad.blend),
  );
  material.colorNode = vec4(0, 0, 0, cover);
  material.maskShadowNode = cover.greaterThan(shadowCutoff);
  return material;
}

function sheet(pictures: ImageBitmap[], anisotropy: number): THREE.Texture {
  const [first] = pictures;
  if (!first) throw new Error("no tree pictures");
  const canvas = new OffscreenCanvas(
    first.width * sheetColumns,
    first.height * sheetRows,
  );
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d canvas for the tree sheet");
  pictures.forEach((picture, index) => {
    context.drawImage(
      picture,
      (index % sheetColumns) * first.width,
      Math.floor(index / sheetColumns) * first.height,
      first.width,
      first.height,
    );
  });
  for (const picture of pictures) picture.close();
  const map = new THREE.CanvasTexture(canvas);
  map.flipY = false;
  map.premultiplyAlpha = true;
  map.colorSpace = THREE.NoColorSpace;
  map.anisotropy = Math.min(anisotropy, anisotropyLimit);
  return releaseOnceUploaded(map);
}

function tileKey(x: number, z: number): string {
  return `${String(Math.floor(x / tileSize))}|${String(Math.floor(z / tileSize))}`;
}

function quadGeometry(): THREE.BufferGeometry {
  const plane = new THREE.PlaneGeometry(1, 1);
  plane.translate(0, 0.5, 0);
  return plane;
}

function field(values: Float32Array, at: number): number {
  return values[at] ?? 0;
}

function instanced(
  plane: THREE.BufferGeometry,
  values: Float32Array,
  indices: number[],
  material: (instances: Instances) => THREE.Material,
  spreadInTint: boolean,
): THREE.InstancedMesh {
  const instances: Instances = {
    place: new THREE.InstancedBufferAttribute(
      new Float32Array(indices.length * 4),
      4,
    ),
    look: new THREE.InstancedBufferAttribute(
      new Float32Array(indices.length * 4),
      4,
    ),
    frame: new THREE.InstancedBufferAttribute(
      new Float32Array(indices.length * 4),
      4,
    ),
  };
  const mesh = new THREE.InstancedMesh(
    plane,
    material(instances),
    indices.length,
  );
  const matrix = new THREE.Matrix4();
  indices.forEach((source, i) => {
    const x = field(values, source);
    const north = field(values, source + 1);
    const up = field(values, source + 2);
    const height = field(values, source + 3);
    const kind = Math.round(field(values, source + 4));
    const seed = field(values, source + 5);
    const shape = table.species[speciesNames[kind] ?? "oak"];
    const [low = 1, high = 1] = shape.sizes;
    const [lowDrop = 0, highDrop = 0] = shape.drops;
    instances.place.setXYZW(i, x, up, -north, height);
    instances.look.setXYZW(
      i,
      kind,
      seed,
      spreadInTint ? shape.spread : (seed * 7.31) % 1,
      (seed * 13.7) % 1,
    );
    instances.frame.setXYZW(i, low, high, lowDrop, highDrop);
    const span = height * Math.max(low, high) * 2;
    matrix.makeScale(span, span, span);
    matrix.setPosition(x, up - span * 0.25, -north);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.computeBoundingSphere();
  return mesh;
}

export class Trees {
  readonly root = new THREE.Group();
  private readonly inverse = new THREE.Matrix4();
  private readonly scratch = new THREE.Vector3();

  private constructor() {}

  static async load(url: string, anisotropy: number): Promise<Trees> {
    const loader = new THREE.ImageBitmapLoader();
    loader.setOptions({ premultiplyAlpha: "none" });
    const picture = (name: string) => loader.loadAsync(fileUrl(name));
    const [response, colours, shapes] = await Promise.all([
      fetch(url),
      Promise.all(speciesNames.map((name) => picture(`${name}.webp`))),
      Promise.all(speciesNames.map((name) => picture(`${name}-shape.webp`))),
    ]);
    const albedo = sheet(colours, anisotropy);
    const form = sheet(shapes, anisotropy);
    const values = new Float32Array(await response.arrayBuffer());
    const trees = new Trees();
    const plane = quadGeometry();
    const tiles = new Map<string, number[]>();
    for (let i = 0; i < values.length; i += stride) {
      const key = tileKey(field(values, i), -field(values, i + 1));
      const list = tiles.get(key) ?? [];
      list.push(i);
      tiles.set(key, list);
    }
    for (const indices of tiles.values()) {
      const seen = instanced(
        plane,
        values,
        indices,
        (instances) => foliage(albedo, form, instances),
        false,
      );
      seen.renderOrder = alphaTestedOrder;
      seen.receiveShadow = false;
      seen.castShadow = false;
      trees.root.add(seen);
      const casters = indices.filter((i) => field(values, i + 6) > 0.5);
      if (casters.length === 0) continue;
      const cast = instanced(
        plane,
        values,
        casters,
        (instances) => shade(albedo, instances),
        true,
      );
      cast.castShadow = true;
      cast.receiveShadow = false;
      cast.layers.set(shadowOnlyLayer);
      trees.root.add(cast);
    }
    return trees;
  }

  update(eye: THREE.Vector3, sun: THREE.Vector3, light: THREE.Color): void {
    this.root.updateWorldMatrix(true, false);
    this.inverse.copy(this.root.matrixWorld).invert();
    eyeModel.value.copy(this.scratch.copy(eye).applyMatrix4(this.inverse));
    sunModel.value
      .copy(this.scratch.copy(sun).transformDirection(this.inverse))
      .normalize();
    sunLight.value.copy(light);
    shadowRing.value = sunModel.value.y > highRingFrom ? 1 : 0;
  }
}
