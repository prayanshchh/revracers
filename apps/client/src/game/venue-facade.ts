import * as THREE from "three/webgpu";
import {
  float,
  floor,
  fract,
  fwidth,
  hash,
  mix,
  normalWorld,
  positionWorld,
  smoothstep,
  step,
  uv,
  vec2,
  vec3,
} from "three/tsl";

const paneWidth = 1.75;
const mullion = 0.045;
const storeys = [0.171, 0.598];
const spandrel = 0.03;
const transoms = [0.385, 0.8];
const transom = 0.006;
const glassTint = vec3(0.16, 0.2, 0.23);
const frameColour = vec3(0.5, 0.51, 0.53);
const slabColour = vec3(0.62, 0.62, 0.6);
const blindColour = vec3(0.56, 0.55, 0.52);
const blindShare = 0.1;
const blindDrop = 0.45;
const litShare = 0.22;
const litColour = vec3(1.0, 0.86, 0.62);
const litLevel = 0.5;
const glassRoughness = 0.07;
const glassMetalness = 0.85;
const frameRoughness = 0.45;
const blindRoughness = 0.85;

function band(
  value: THREE.Node<"float">,
  centre: number,
  half: number,
): THREE.Node<"float"> {
  const width = fwidth(value).max(1e-4);
  const distance = value.sub(centre).abs();
  return float(1).sub(smoothstep(float(half), width.add(half), distance));
}

export function glaze(material: THREE.MeshStandardNodeMaterial): void {
  const facing = normalWorld.xy;
  const side = vec2(facing.y.negate(), facing.x).normalize();
  const along = positionWorld.xy.dot(side).div(paneWidth);
  const height = float(1).sub(uv().y);
  const post = along.sub(0.5).fract().sub(0.5).abs().mul(paneWidth);
  const postWidth = fwidth(along).mul(paneWidth).max(1e-4);
  const upright = float(1).sub(
    smoothstep(float(mullion), postWidth.add(mullion), post),
  );
  const rail = transoms
    .map((level) => band(height, level, transom))
    .reduce((a, b) => a.max(b));
  const slab = storeys
    .map((level) => band(height, level, spandrel))
    .reduce((a, b) => a.max(b));
  const storey = storeys
    .map((level) => step(level, height))
    .reduce((a, b) => a.add(b));
  const pane = floor(along.sub(0.5)).add(storey.mul(37.7));
  const roll = hash(pane);
  const blind = step(roll, float(blindShare));
  const lit = step(float(1 - litShare), roll);
  const within = storeys
    .map((level, index) => {
      const top = storeys[index + 1] ?? 1;
      return height
        .sub(level)
        .div(top - level)
        .mul(step(level, height))
        .mul(step(height, top));
    })
    .reduce((a, b) => a.add(b));
  const shaded = step(float(1 - blindDrop), within).mul(blind);
  const frame = upright.max(rail);
  const glass = mix(glassTint, blindColour, shaded);
  material.colorNode = mix(mix(glass, frameColour, frame), slabColour, slab);
  const solid = frame.max(slab);
  material.roughnessNode = mix(
    mix(float(glassRoughness), float(blindRoughness), shaded),
    float(frameRoughness),
    solid,
  );
  material.metalnessNode = mix(
    float(glassMetalness),
    float(0),
    solid.max(shaded),
  );
  material.emissiveNode = litColour
    .mul(litLevel)
    .mul(lit)
    .mul(float(1).sub(solid))
    .mul(smoothstep(0.55, 0.95, fract(height.mul(2.4).add(0.1))));
}

const curtainPane = 1.5;
const curtainRow = 1.9;
const curtainFrame = 0.05;
const curtainTransom = 0.03;
const curtainInterior = vec3(0.05, 0.065, 0.08);
const curtainDeep = vec3(0.02, 0.025, 0.03);
const curtainBlind = vec3(0.42, 0.42, 0.4);
const curtainMullion = vec3(0.16, 0.17, 0.18);
const curtainBlinds = 0.18;
const curtainIor = 2.2;
const curtainLight = vec3(1.0, 0.86, 0.66);
const curtainGlow = 0.22;
const curtainLit = 0.45;
const curtainFloor = 0.3;

export function curtain(material: THREE.MeshStandardNodeMaterial): void {
  const at = uv();
  const across = at.x.div(curtainPane);
  const up = at.y.div(curtainRow);
  const postGap = across.sub(0.5).fract().sub(0.5).abs().mul(curtainPane);
  const railGap = up.sub(0.5).fract().sub(0.5).abs().mul(curtainRow);
  const soft = fwidth(at.x).add(fwidth(at.y)).max(1e-4);
  const post = float(1).sub(
    smoothstep(float(curtainFrame), soft.add(curtainFrame), postGap),
  );
  const rail = float(1).sub(
    smoothstep(float(curtainTransom), soft.add(curtainTransom), railGap),
  );
  const pane = floor(across).add(floor(up).mul(53.1));
  const roll = hash(pane);
  const height = up.fract();
  const blind = step(roll, float(curtainBlinds)).mul(step(0.55, height));
  const depth = mix(curtainDeep, curtainInterior, hash(pane.add(7.3)));
  const interior = mix(depth, curtainBlind, blind);
  const frame = post.max(rail);
  material.colorNode = mix(interior, curtainMullion, frame);
  material.roughnessNode = mix(
    mix(float(0.05), float(0.6), blind),
    float(0.4),
    frame,
  );
  material.metalnessNode = mix(float(0), float(0.3), frame);
  const rise = float(1).sub(height);
  const ceiling = rise
    .mul(rise)
    .mul(float(1).sub(curtainFloor))
    .add(curtainFloor);
  const lit = step(hash(pane.add(3.1)), float(curtainLit))
    .mul(float(1).sub(blind))
    .mul(float(1).sub(frame));
  material.emissiveNode = curtainLight.mul(ceiling.mul(lit).mul(curtainGlow));
  if (material instanceof THREE.MeshPhysicalNodeMaterial)
    material.ior = curtainIor;
}
