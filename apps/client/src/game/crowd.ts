import * as THREE from "three/webgpu";
import { alphaTestedOrder } from "./road.ts";
import { skyIrradiance, SkyLitMaterial } from "./sky-ambient.ts";
import {
  attribute,
  cos,
  float,
  floor,
  Fn,
  fract,
  instancedBufferAttribute,
  mix,
  normalize,
  positionGeometry,
  sin,
  smoothstep,
  step,
  texture,
  time,
  uniform,
  uniformArray,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import albedoUrl from "../../../../content/scenery/crowd/people.webp?url";
import crowdUrl from "../../../../content/tracks/hill-country/crowd.bin?url";
import maskUrl from "../../../../content/scenery/crowd/people-mask.webp?url";
import { releaseOnceUploaded } from "./preload.ts";

export const crowdFiles = [albedoUrl, crowdUrl, maskUrl];
export const crowdData = crowdUrl;
export const crowdAtlas = [albedoUrl, maskUrl];
import {
  alphaCutoff,
  atlasColumns,
  farCutoff,
  atlasRows,
  cowboyCells,
  spriteBounds,
} from "./sprite-bounds.ts";

const stride = 8;
const tileSize = 600;
const personHeight = 2;
const personWidth = 1;
const bobHeight = 0.05;
const bobRate = 3.2;
const cheerRate = 7.5;
const cheerHeight = 0.11;
const cheerNear = 18;
const cheerFar = 55;
const skinGain = 1.0;
const heightJitter = 0.07;
const views = 3;
export const standingFrom = (atlasColumns * atlasRows) / views / 2;
export const plainSprites = standingFrom - cowboyCells;
const bounceFill = 0.5;
const lampFill = 0.22;
export const crowdLamps = uniform(0);
const bounceFacing = 0.75;
const fanColours: [string, number][] = [
  ["#f2f2f0", 20],
  ["#1b1b1d", 10],
  ["#c8202a", 18],
  ["#9a1820", 3],
  ["#1d2b4f", 9],
  ["#8a8d91", 3],
  ["#b8b9bb", 3],
  ["#ff7a1a", 8],
  ["#19a7a0", 3],
  ["#1f5c3a", 2],
  ["#2453c7", 6],
  ["#6fb7e8", 3],
  ["#d8e021", 2],
  ["#f4c20d", 2],
  ["#c8b48a", 4],
  ["#e8508e", 2],
  ["#6b1f2b", 2],
];
const capColours: [string, number][] = [
  ["#c8202a", 26],
  ["#f2f2f0", 24],
  ["#1b1b1d", 18],
  ["#1d2b4f", 9],
  ["#ff7a1a", 8],
  ["#19a7a0", 4],
  ["#c8b48a", 5],
  ["#2453c7", 4],
  ["#f4c20d", 2],
];
const umbrellaShare = 0.035;
const seatShade = 0.55;
const cutoffNear = 45;
const cutoffFar = 220;
const campShare = 0.15;
const chairSeat = 0.42;
const chairColours: [string, number][] = [
  ["#1a2a5c", 5],
  ["#16161a", 5],
  ["#2f6a3a", 2],
  ["#a3242a", 3],
  ["#4c5560", 3],
  ["#1f6fa8", 2],
];
const umbrellaRibs = 8;
const umbrellaHeight = 1.95;
const umbrellaRadius = [0.55, 0.85] as const;
const umbrellaDome = 0.36;
const umbrellaTilt = 0.32;
const umbrellaColours: [string, number][] = [
  ["#16161a", 32],
  ["#f0efea", 14],
  ["#c42a2e", 12],
  ["#1d3f8a", 7],
  ["#4fb8d8", 4],
  ["#ee6a1f", 5],
  ["#e05a8a", 4],
  ["#7a3fa0", 2],
  ["#1c6e4a", 3],
  ["#f2c12e", 3],
  ["#6a6d72", 5],
];
const flagShare = 0.0015;
const fanFlagShare = 0.0025;
const flagSize = [0.95, 0.6] as const;
const flagGrip = 1.35;
const flagPole = 1.25;
const flagSegments = [10, 4] as const;
const flagWave = 0.12;
const flagRate = 5.5;
const flagPairs = [
  ["#ff7a1a", "#1b1b1d"],
  ["#c8202a", "#f4c20d"],
  ["#1d2b4f", "#f2f2f0"],
  ["#19a7a0", "#f2f2f0"],
  ["#2453c7", "#c8202a"],
  ["#1f7a3a", "#f2f2f0"],
  ["#f2f2f0", "#c8202a"],
  ["#1b1b1d", "#f4c20d"],
] as const;

function fillLight(): THREE.Node<"vec3"> {
  return Fn(() => skyIrradiance(float(bounceFacing)))()
    .mul(bounceFill / Math.PI)
    .add(crowdLamps.mul(lampFill));
}

function pickWeighted(
  roll: number,
  colours: [string, number][] = fanColours,
): THREE.Color {
  const total = colours.reduce((sum, [, weight]) => sum + weight, 0);
  let left = roll * total;
  for (const [colour, weight] of colours) {
    left -= weight;
    if (left <= 0) return new THREE.Color(colour);
  }
  return new THREE.Color(colours[0]?.[0] ?? "#ffffff");
}

function roll(index: number, salt: number): number {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const eyeModel = uniform(new THREE.Vector3());
const cheerSlots = 4;
const cheerCars = Array.from(
  { length: cheerSlots },
  () => new THREE.Vector3(0, -1e5, 0),
);
const cheerModel = uniformArray(cheerCars, "vec3");
const viewEdges = [0.3, 0.9] as const;
const viewStagger = 0.16;

type Atlas = CanvasImageSource & { width: number; height: number };

function alphaOf(image: Atlas): Float32Array {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d canvas for the crowd atlas");
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, image.width, image.height).data;
  const alpha = new Float32Array(image.width * image.height);
  for (let i = 0; i < alpha.length; i++)
    alpha[i] = (rgba[i * 4 + 3] ?? 0) / 255;
  return alpha;
}

function material(
  albedo: THREE.Texture,
  mask: THREE.Texture,
  boxes: ReturnType<typeof uniformArray>,
  origin: THREE.InstancedBufferAttribute,
  shirt: THREE.InstancedBufferAttribute,
  hat: THREE.InstancedBufferAttribute,
  face: THREE.InstancedBufferAttribute,
) {
  const result = new SkyLitMaterial({
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
    alphaTest: alphaCutoff,
  });
  const place = vec4(
    instancedBufferAttribute(origin) as ReturnType<typeof vec4>,
  );
  const tint = vec4(instancedBufferAttribute(shirt) as ReturnType<typeof vec4>);
  const toEye = eyeModel.sub(place.xyz);
  const flat = normalize(vec2(toEye.x, toEye.z));
  const right = vec3(flat.y, 0, flat.x.negate());
  const phase = place.x.mul(0.37).add(place.z.mul(0.71));
  const closest = Array.from({ length: cheerSlots }, (_, k) =>
    (cheerModel.element(k) as unknown as THREE.Node<"vec3">)
      .sub(place.xyz)
      .length(),
  ).reduce((a, b) => a.min(b));
  const near = smoothstep(float(cheerFar), float(cheerNear), closest).mul(
    step(float(standingFrom - 0.5), tint.w),
  );
  const facing = vec2(
    instancedBufferAttribute(face) as ReturnType<typeof vec2>,
  );
  const faced = step(float(1e-3), facing.length());
  const front = flat.dot(facing).clamp(-1, 1).acos();
  const stagger = fract(sin(phase.mul(12.9898)).mul(43758.5453))
    .sub(0.5)
    .mul(viewStagger);
  const view = step(stagger.add(viewEdges[0]), front)
    .add(step(stagger.add(viewEdges[1]), front))
    .mul(faced);
  const mirror = step(
    flat.dot(vec2(facing.y, facing.x.negate())),
    float(0),
  ).mul(faced);
  const bob = sin(
    time.mul(mix(float(bobRate), float(cheerRate), near)).add(phase),
  )
    .abs()
    .mul(mix(float(bobHeight), float(cheerHeight), near));
  const identity = floor(tint.w);
  const atlasCell = identity.mul(views).add(view);
  const box = boxes.element(atlasCell.toInt()) as unknown as THREE.Node<"vec4">;
  const low = mix(box.x, float(1).sub(box.y), mirror);
  const high = mix(box.y, float(1).sub(box.x), mirror);
  const across = mix(low, high, positionGeometry.x.add(0.5));
  const down = mix(box.z, box.w, float(1).sub(positionGeometry.y));
  result.positionNode = place.xyz
    .add(right.mul(across.sub(0.5).mul(personWidth).mul(place.w)))
    .add(
      vec3(0, float(1).sub(down).mul(personHeight).mul(place.w).add(bob), 0),
    );
  const cell = varying(identity);
  const tile = varying(atlasCell);
  const u = mix(
    varying(across),
    float(1).sub(varying(across)),
    varying(mirror),
  );
  const sprite = vec2(
    tile.mod(atlasColumns).add(u).div(atlasColumns),
    floor(tile.div(atlasColumns)).add(varying(down)).div(atlasRows),
  );
  const colour = texture(albedo, sprite);
  const marks = texture(mask, sprite);
  const capTint = vec3(
    instancedBufferAttribute(hat) as ReturnType<typeof vec3>,
  );
  const dressed = mix(
    colour.rgb.mul(skinGain),
    colour.rgb.mul(varying(tint.xyz)).mul(1.1),
    marks.r,
  );
  const painted = mix(
    dressed,
    colour.rgb.mul(varying(capTint)).mul(1.15),
    marks.g,
  );
  const sits = step(cell, float(standingFrom - 0.5));
  const lap = mix(
    float(1),
    float(seatShade),
    smoothstep(0.55, 0.8, varying(down)).mul(sits),
  );
  const shaded = painted.mul(lap);
  result.colorNode = vec4(shaded, colour.a);
  result.alphaTestNode = mix(
    float(alphaCutoff),
    float(farCutoff),
    smoothstep(float(cutoffNear), float(cutoffFar), varying(toEye.length())),
  );
  result.normalNode = vec3(0, 0.5, 0.87);
  result.emissiveNode = shaded.mul(fillLight());
  return result;
}

function flagGeometry(): THREE.BufferGeometry {
  const cloth = new THREE.PlaneGeometry(1, 1, ...flagSegments);
  cloth.translate(0.5, 0.5, 0);
  const pole = new THREE.PlaneGeometry(0.03, 1);
  pole.translate(-0.015, 0.5, 0);
  const parts = [cloth, pole].map((part, index) => {
    const geometry = part.toNonIndexed();
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute(
      "cloth",
      new THREE.BufferAttribute(new Float32Array(count).fill(1 - index), 1),
    );
    return geometry;
  });
  const merged = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv", "cloth"]) {
    const arrays = parts.map(
      (part) => part.getAttribute(name).array as Float32Array,
    );
    const size = parts[0]?.getAttribute(name).itemSize ?? 1;
    const joined = new Float32Array(
      arrays.reduce((sum, array) => sum + array.length, 0),
    );
    let at = 0;
    for (const array of arrays) {
      joined.set(array, at);
      at += array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(joined, size));
  }
  return merged;
}

function flagMaterial(
  place: THREE.InstancedBufferAttribute,
  colours: THREE.InstancedBufferAttribute,
  second: THREE.InstancedBufferAttribute,
) {
  const result = new SkyLitMaterial({
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0,
  });
  const at = vec4(instancedBufferAttribute(place) as ReturnType<typeof vec4>);
  const first = vec4(
    instancedBufferAttribute(colours) as ReturnType<typeof vec4>,
  );
  const other = vec3(
    instancedBufferAttribute(second) as ReturnType<typeof vec3>,
  );
  const cloth = attribute<"float">("cloth", "float");
  const toEye = eyeModel.sub(at.xyz);
  const flat = normalize(vec2(toEye.x, toEye.z));
  const right = vec3(flat.y, 0, flat.x.negate());
  const forward = vec3(flat.x, 0, flat.y);
  const u = positionGeometry.x;
  const swing = time.mul(flagRate).add(at.w.mul(6.3)).sub(u.mul(4.5));
  const wave = sin(swing).mul(u).mul(flagWave);
  const sweep = cos(time.mul(1.3).add(at.w.mul(3)))
    .mul(0.25)
    .mul(u);
  const width = mix(float(1), float(flagSize[0]), cloth);
  const tall = mix(float(flagPole), float(flagSize[1]), cloth);
  const lift = mix(
    float(flagGrip - 0.15),
    float(flagGrip + flagPole - flagSize[1]),
    cloth,
  );
  result.positionNode = at.xyz
    .add(right.mul(u.mul(width)))
    .add(forward.mul(wave.add(sweep).mul(cloth)))
    .add(vec3(0, positionGeometry.y.mul(tall).add(lift), 0));
  const slope = cos(swing)
    .mul(u)
    .mul(flagWave * 4.5)
    .mul(cloth);
  result.normalNode = normalize(vec3(slope.negate(), 0, 1));
  const pattern = floor(first.w);
  const band = mix(
    step(0.5, fract(uv().y.mul(1.5))),
    step(0.33, uv().x).mul(step(uv().x, 0.66)),
    step(0.5, pattern),
  );
  const fabric = mix(first.xyz, other, band);
  const flag = mix(vec3(0.08, 0.08, 0.09), fabric, cloth);
  result.colorNode = flag;
  result.emissiveNode = flag.mul(fillLight());
  return result;
}

function triple(values: Float32Array, at: number): [number, number, number] {
  return [values[at] ?? 0, values[at + 1] ?? 0, values[at + 2] ?? 0];
}

function flagPair(person: number): [THREE.Color, THREE.Color] {
  const [a, b] =
    flagPairs[Math.floor(roll(person, 9) * flagPairs.length)] ?? flagPairs[0];
  return [new THREE.Color(a), new THREE.Color(b)];
}

function flags(values: Float32Array): THREE.InstancedMesh {
  const chosen: number[] = [];
  for (let i = 0; i < values.length; i += stride) {
    const share = (values[i + 3] ?? 0) >= 1 ? fanFlagShare : flagShare;
    if (roll(i / stride, 7) < share) chosen.push(i);
  }
  const place = new THREE.InstancedBufferAttribute(
    new Float32Array(chosen.length * 4),
    4,
  );
  const colours = new THREE.InstancedBufferAttribute(
    new Float32Array(chosen.length * 4),
    4,
  );
  const second = new THREE.InstancedBufferAttribute(
    new Float32Array(chosen.length * 3),
    3,
  );
  const mesh = new THREE.InstancedMesh(
    flagGeometry(),
    flagMaterial(place, colours, second),
    chosen.length,
  );
  const matrix = new THREE.Matrix4();
  chosen.forEach((source, i) => {
    const person = source / stride;
    const [x, north, up] = triple(values, source);
    place.setXYZW(i, x, up, -north, roll(person, 8));
    const [a, b] = flagPair(person);
    colours.setXYZW(i, a.r, a.g, a.b, roll(person, 10) < 0.5 ? 0 : 1);
    second.setXYZ(i, b.r, b.g, b.b);
    matrix.makeTranslation(x, up + flagGrip, -north);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

function seating(
  i: number,
  kind: number,
  first: number,
  rise: number,
): [number, number] {
  if (kind === 1) return roll(i, 21) < campShare ? [2, 0] : [kind, first];
  return first === 0 && roll(i, 24) < rise
    ? [kind, standingFrom]
    : [kind, first];
}

function settle(
  slots: THREE.Vector3[],
  reach: Float64Array,
  distance: number,
  at: number[],
): void {
  let slot = reach.length - 1;
  if (distance >= Number(reach[slot])) return;
  while (slot > 0 && distance < Number(reach[slot - 1])) {
    reach[slot] = Number(reach[slot - 1]);
    const before = slots[slot - 1];
    if (before) slots[slot]?.copy(before);
    slot--;
  }
  reach[slot] = distance;
  slots[slot]?.fromArray(at);
}

export function nearestCars(
  cars: Float64Array | null,
  carStride: number,
  eye: THREE.Vector3,
  slots: THREE.Vector3[],
  reach: Float64Array,
): void {
  reach.fill(Infinity);
  for (const slot of slots) slot.set(0, -1e5, 0);
  if (!cars) return;
  const at = [0, 0, 0];
  for (let k = carStride; k + 14 < cars.length; k += carStride) {
    at[0] = Number(cars[k + 12]);
    at[1] = Number(cars[k + 13]);
    at[2] = Number(cars[k + 14]);
    settle(slots, reach, eye.distanceToSquared(scratchCar.fromArray(at)), at);
  }
}

const scratchCar = new THREE.Vector3();

export const riseShare = 0.22;

export function placedCrowd(
  standing: number[],
  seated: number[],
  fans: number[] = [],
  sprites = standingFrom,
  rise = 0,
): Float32Array {
  const groups: [number[], number, number][] = [
    [seated, 0, 0],
    [standing, standingFrom, 0],
    [fans, standingFrom, 1],
  ];
  const count = groups.reduce(
    (sum, [spots]) => sum + Math.floor(spots.length / 3),
    0,
  );
  const values = new Float32Array(count * stride);
  let i = 0;
  for (const [spots, first, kind] of groups)
    for (let at = 0; at + 2 < spots.length; at += 3, i++) {
      values[i * stride] = spots[at] ?? 0;
      values[i * stride + 1] = -(spots[at + 2] ?? 0);
      values[i * stride + 2] = spots[at + 1] ?? 0;
      const [look, cell] = seating(i, kind, first, rise);
      values[i * stride + 3] = look;
      values[i * stride + 4] = cell + Math.floor(roll(i, 5) * sprites);
    }
  return values;
}

function umbrellaGeometry(): THREE.BufferGeometry {
  const position: number[] = [];
  const shade: number[] = [];
  const corner = (k: number, lift: number, reach: number) => {
    const angle = (k / umbrellaRibs) * Math.PI;
    return [Math.cos(angle) * reach, lift, Math.sin(angle) * reach];
  };
  for (let k = 0; k < umbrellaRibs * 2; k++) {
    const rib = k % 2 === 0;
    const a = corner(k, 0, 1);
    const b = corner(k + 1, rib ? 0.05 : -0.05, rib ? 0.94 : 1);
    position.push(0, umbrellaDome, 0, ...a, ...b);
    shade.push(1, 1, 1);
  }
  const pole = 0.018;
  const low = -umbrellaHeight * 0.55;
  for (const [x, z] of [
    [pole, 0],
    [0, pole],
  ] as const)
    position.push(
      -x,
      low,
      -z,
      x,
      low,
      z,
      x,
      umbrellaDome,
      z,
      -x,
      low,
      -z,
      x,
      umbrellaDome,
      z,
      -x,
      umbrellaDome,
      -z,
    );
  while (shade.length < position.length / 3) shade.push(0);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(position), 3),
  );
  geometry.setAttribute(
    "canopy",
    new THREE.BufferAttribute(new Float32Array(shade), 1),
  );
  geometry.computeVertexNormals();
  return geometry;
}

function umbrellaMaterial(tint: THREE.InstancedBufferAttribute, solid = 0) {
  const result = new SkyLitMaterial({
    side: THREE.DoubleSide,
    roughness: 0.8,
    metalness: 0,
  });
  const canopy = solid > 0 ? float(1) : attribute<"float">("canopy", "float");
  const fabric = vec3(
    instancedBufferAttribute(tint) as ReturnType<typeof vec3>,
  );
  const colour = mix(vec3(0.05, 0.05, 0.05), fabric, canopy);
  result.colorNode = colour;
  result.emissiveNode = colour.mul(fillLight());
  return result;
}

function chairGeometry(): THREE.BufferGeometry {
  const quads: number[][][] = [
    [
      [-0.25, chairSeat, -0.22],
      [0.25, chairSeat, -0.22],
      [0.25, chairSeat - 0.06, 0.2],
      [-0.25, chairSeat - 0.06, 0.2],
    ],
    [
      [-0.25, chairSeat - 0.06, 0.2],
      [0.25, chairSeat - 0.06, 0.2],
      [0.27, chairSeat + 0.5, 0.32],
      [-0.27, chairSeat + 0.5, 0.32],
    ],
  ];
  for (const side of [-1, 1])
    quads.push([
      [-0.24, 0, side * 0.2],
      [0.24, 0, side * 0.2],
      [0.24, chairSeat, -side * 0.2],
      [-0.24, chairSeat, -side * 0.2],
    ]);
  const position = quads.flatMap(([a = [], b = [], c = [], d = []]) => [
    ...a,
    ...b,
    ...c,
    ...a,
    ...c,
    ...d,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(position), 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}

function chairs(values: Float32Array): THREE.InstancedMesh | null {
  const chosen: number[] = [];
  for (let i = 0; i < values.length; i += stride)
    if ((values[i + 3] ?? 0) >= 2) chosen.push(i);
  if (chosen.length === 0) return null;
  const tint = new THREE.InstancedBufferAttribute(
    new Float32Array(chosen.length * 3),
    3,
  );
  const mesh = new THREE.InstancedMesh(
    chairGeometry(),
    umbrellaMaterial(tint, 1),
    chosen.length,
  );
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  chosen.forEach((source, i) => {
    const person = source / stride;
    const [x, north, rise] = triple(values, source);
    const fx = values[source + 5] ?? 0;
    const fz = -(values[source + 6] ?? 0);
    const yaw =
      fx !== 0 || fz !== 0
        ? Math.atan2(-fx, -fz) + (roll(person, 22) - 0.5) * 0.6
        : roll(person, 22) * Math.PI * 2;
    turn.setFromAxisAngle(up, yaw);
    at.set(x, rise, -north);
    matrix.compose(at, turn, one);
    mesh.setMatrixAt(i, matrix);
    const colour = pickWeighted(roll(person, 23), chairColours);
    tint.setXYZ(i, colour.r, colour.g, colour.b);
  });
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

function umbrellas(values: Float32Array): THREE.InstancedMesh | null {
  const chosen: number[] = [];
  for (let i = 0; i < values.length; i += stride)
    if ((values[i + 3] ?? 0) >= 1 && roll(i / stride, 11) < umbrellaShare)
      chosen.push(i);
  if (chosen.length === 0) return null;
  const tint = new THREE.InstancedBufferAttribute(
    new Float32Array(chosen.length * 3),
    3,
  );
  const mesh = new THREE.InstancedMesh(
    umbrellaGeometry(),
    umbrellaMaterial(tint),
    chosen.length,
  );
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const tilt = new THREE.Euler();
  const scale = new THREE.Vector3();
  const at = new THREE.Vector3();
  chosen.forEach((source, i) => {
    const person = source / stride;
    const [x, north, up] = triple(values, source);
    const radius =
      umbrellaRadius[0] +
      (umbrellaRadius[1] - umbrellaRadius[0]) * roll(person, 12);
    tilt.set(
      (roll(person, 13) - 0.5) * umbrellaTilt,
      roll(person, 14) * Math.PI * 2,
      (roll(person, 15) - 0.5) * umbrellaTilt,
    );
    turn.setFromEuler(tilt);
    scale.set(radius, radius, radius);
    at.set(x, up + umbrellaHeight * (0.92 + 0.12 * roll(person, 16)), -north);
    matrix.compose(at, turn, scale);
    mesh.setMatrixAt(i, matrix);
    const colour = pickWeighted(roll(person, 17), umbrellaColours);
    tint.setXYZ(i, colour.r, colour.g, colour.b);
  });
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

export class Crowd {
  readonly root = new THREE.Group();
  private readonly inverse = new THREE.Matrix4();
  private readonly scratch = new THREE.Vector3();

  private constructor() {}

  static async load(placed?: Promise<Float32Array>): Promise<Crowd> {
    const crowd = new Crowd();
    crowd.root.name = "crowd";
    const loader = new THREE.TextureLoader();
    const atlas = async (url: string, colorSpace: string) => {
      const map = releaseOnceUploaded(await loader.loadAsync(url));
      map.flipY = false;
      map.colorSpace = colorSpace;
      return map;
    };
    const sprites = async () => {
      const map = await atlas(albedoUrl, THREE.SRGBColorSpace);
      const image = map.image as Atlas;
      return {
        map,
        bounds: spriteBounds(alphaOf(image), image.width, image.height),
      };
    };
    const [{ map: albedo, bounds }, mask, values] = await Promise.all([
      sprites(),
      atlas(maskUrl, THREE.NoColorSpace),
      placed ??
        fetch(crowdUrl)
          .then((response) => response.arrayBuffer())
          .then((buffer) => new Float32Array(buffer)),
    ]);
    const boxes = uniformArray(bounds, "vec4");
    const tiles = new Map<string, number[]>();
    for (let i = 0; i < values.length; i += stride) {
      const key = `${String(Math.floor((values[i] ?? 0) / tileSize))}|${String(Math.floor((values[i + 1] ?? 0) / tileSize))}`;
      const list = tiles.get(key) ?? [];
      list.push(i);
      tiles.set(key, list);
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.translate(0, 0.5, 0);
    const matrix = new THREE.Matrix4();
    for (const indices of tiles.values()) {
      const origin = new THREE.InstancedBufferAttribute(
        new Float32Array(indices.length * 4),
        4,
      );
      const shirt = new THREE.InstancedBufferAttribute(
        new Float32Array(indices.length * 4),
        4,
      );
      const hat = new THREE.InstancedBufferAttribute(
        new Float32Array(indices.length * 3),
        3,
      );
      const face = new THREE.InstancedBufferAttribute(
        new Float32Array(indices.length * 2),
        2,
      );
      const mesh = new THREE.InstancedMesh(
        plane,
        material(albedo, mask, boxes, origin, shirt, hat, face),
        indices.length,
      );
      indices.forEach((source, i) => {
        const x = values[source] ?? 0;
        const north = values[source + 1] ?? 0;
        const up = values[source + 2] ?? 0;
        const person = source / stride;
        const scale = 1 + (roll(person, 1) - 0.5) * 2 * heightJitter;
        origin.setXYZW(i, x, up, -north, scale);
        const fan = pickWeighted(roll(person, 2)).multiplyScalar(
          0.82 + 0.25 * roll(person, 3),
        );
        shirt.setXYZW(i, fan.r, fan.g, fan.b, values[source + 4] ?? 0);
        const cap = pickWeighted(roll(person, 4), capColours);
        hat.setXYZ(i, cap.r, cap.g, cap.b);
        face.setXY(i, values[source + 5] ?? 0, -(values[source + 6] ?? 0));
        matrix.makeScale(personHeight, personHeight, personHeight);
        matrix.setPosition(x, up, -north);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.computeBoundingSphere();
      mesh.renderOrder = alphaTestedOrder;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      crowd.root.add(mesh);
    }
    crowd.root.add(flags(values));
    const shades = umbrellas(values);
    if (shades) crowd.root.add(shades);
    const seats = chairs(values);
    if (seats) crowd.root.add(seats);
    return crowd;
  }

  update(eye: THREE.Vector3, cars: readonly THREE.Vector3[] = []): void {
    this.root.updateWorldMatrix(true, false);
    this.inverse.copy(this.root.matrixWorld).invert();
    eyeModel.value.copy(this.scratch.copy(eye).applyMatrix4(this.inverse));
    cheerCars.forEach((slot, k) => {
      const car = cars[k];
      if (car) slot.copy(car).applyMatrix4(this.inverse);
      else slot.set(0, -1e5, 0);
    });
  }
}
