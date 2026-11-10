import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  dFdx,
  dFdy,
  dot,
  faceDirection,
  float,
  floor,
  fract,
  fwidth,
  hash,
  max,
  mix,
  mx_noise_float,
  normalView,
  positionView,
  positionWorld,
  smoothstep,
  struct,
  texture,
  uv,
  vec2,
  vec3,
  vertexStage,
} from "three/tsl";

type FloatNode = THREE.Node<"float">;
type ColourNode = THREE.Node<"vec3">;

const asphaltTile = 2;
const patchCell = 46;
const patchShare = 0.4;
const patchTone = 0.82;
const patchSeam = 0.05;
const crackScale = vec2(0.21, 0.075);
const crackWidth = 0.018;
const crackDensity = 0.022;
const crackTone = 0.42;
const crackRoughness = 0.3;
const blotchScale = 0.045;
const blotchStrength = 0.11;
const mottleScale = 0.6;
const mottleStrength = 0.07;
const coarseScale = 0.27;
const coarseContrast = 0.35;
const kerbBlock = 0.5;
const kerbRed = vec3(0.5, 0.042, 0.03);
const kerbWhite = vec3(0.74, 0.74, 0.71);
const kerbGrain = 0.3;
const kerbRubber = 0.62;
const kerbSeam = 0.035;
const kerbGroove = 0.012;
const kerbWidth = 1.5;
const kerbTile = 5;
const kerbGrainScale = 0.9;
const kerbGrooveDepth = 0.006;
const kerbFoot = 0.025;
const kerbFootShade = 0.6;
const kerbFace = 0.004;
const kerbJoint = 0.035;
const kerbJointShade = 0.22;
const kerbFaceShade = 0.3;
const kerbFaceGrime = vec3(0.09, 0.085, 0.08);
const kerbFaceRoughness = 0.85;
const kerbGrainDepth = 0.0012;
const kerbPaintRoughness = 0.5;
const kerbRubberRoughness = 0.72;
const lushGreen = vec3(0.062, 0.15, 0.03);
const lushShare = 0.72;
const patchScale = 0.07;
const tuftScale = 1.3;
const tuftStrength = 0.12;
const lushDryShare = 0.45;
const lushDryTint = vec3(1.45, 1.05, 0.7);
const lushLuminance = 0.075;
const turfTile = 2;
const turfSecondTile = 2.9;
const turfSecondAngle = 1.13;
const turfMean = 0.1089;
const turfTint = vec3(1, 1, 1);
const turfCrevice = 0.4;
const turfRelief = 0.004;
const dryScale = 0.045;
const dryShare = 0.65;
const dryTint = vec3(1.28, 1.12, 0.8);
const photoShare = 0.6;
const photoMean = 0.085;
const mowWidth = 4.5;
const mowStrength = 0.09;
const terrainMowAngle = 0.62;
const gravelTile = 4;
const gravelMacroTile = 17.3;
const gravelMacroAngle = 0.83;
const gravelMacroStrength = 0.4;
const gravelMean = 0.4;
const gravelHeightMean = 0.697;
const gravelHeightSpread = 0.094;
const gravelTint = vec3(1.02, 0.95, 0.83);
const gravelCrevice = 0.25;
const gravelRelief = 0.014;
const gravelFurrowAcross = 4.5;
const gravelFurrowAlong = 40;
const gravelFurrowTone = 0.36;
const gravelFurrowDepth = 0.05;
const gravelPatchScale = 0.21;
const gravelPatchTone = 0.16;
const gravelScatter = 0.16;
const gravelReach = 0.3;
const gravelEdgeWobble = 0.3;
const gravelRoughTop = 0.74;
const gravelRoughDeep = 0.97;

function aa(edge: FloatNode, value: FloatNode): FloatNode {
  const width = fwidth(value).max(1e-4);
  return smoothstep(edge.sub(width), edge.add(width), value);
}

function boxDistance(
  lateral: FloatNode,
  along: FloatNode,
  centre: THREE.Node<"vec2">,
  half: THREE.Node<"vec2">,
): FloatNode {
  return max(
    lateral.sub(centre.x).abs().sub(half.x),
    along.sub(centre.y).abs().sub(half.y),
  );
}

function patches(lateral: FloatNode, along: FloatNode) {
  const cell = floor(along.div(patchCell));
  const roll = (salt: number) => hash(cell.add(salt));
  const present = float(1).sub(
    smoothstep(patchShare - 0.01, patchShare, roll(1.3)),
  );
  const length = mix(float(0.22), float(0.7), roll(2.9)).mul(patchCell);
  const start = roll(4.1).mul(float(patchCell).sub(length));
  const width = mix(float(3.2), float(9), roll(6.7));
  const offset = mix(float(-6), float(6), roll(8.3));
  const centre = vec2(
    offset,
    cell.mul(patchCell).add(start).add(length.mul(0.5)),
  );
  const distance = boxDistance(
    lateral,
    along,
    centre,
    vec2(width.mul(0.5), length.mul(0.5)),
  );
  const inside = float(1)
    .sub(aa(float(0), distance))
    .mul(present);
  const seam = float(1)
    .sub(smoothstep(0, patchSeam, distance.abs()))
    .mul(present);
  return { inside, seam };
}

function cracks(lateral: FloatNode, along: FloatNode) {
  const field = mx_noise_float(
    vec2(lateral.mul(crackScale.x), along.mul(crackScale.y)).add(2.7),
  );
  const width = fwidth(field).mul(1.2).add(crackWidth);
  const line = float(1).sub(smoothstep(width.mul(0.35), width, field.abs()));
  const where = smoothstep(
    0.05,
    0.25,
    vertexStage(
      mx_noise_float(vec2(lateral, along).mul(crackDensity).add(9.1)),
    ),
  );
  return line.mul(where);
}

export interface GravelMaps {
  albedo: THREE.Texture;
  height: THREE.Texture;
  streaks: THREE.Texture;
}

const gravelResult = struct({
  colour: "vec3",
  cover: "float",
  relief: "float",
  roughness: "float",
});

export interface GravelBed {
  colour: ColourNode;
  cover: FloatNode;
  relief: FloatNode;
  roughness: FloatNode;
}

export function gravelBed(
  maps: GravelMaps,
  field: FloatNode,
  lateral: FloatNode,
  along: FloatNode,
): GravelBed {
  const world = positionWorld.xy.toVar();
  const tiled = world.div(gravelTile).toVar();
  const c = Math.cos(gravelMacroAngle);
  const s = Math.sin(gravelMacroAngle);
  const turned = vec2(
    world.x.mul(c).sub(world.y.mul(s)),
    world.x.mul(s).add(world.y.mul(c)),
  )
    .div(gravelMacroTile)
    .toVar();
  const raked = vec2(
    lateral.div(gravelFurrowAcross),
    along.div(gravelFurrowAlong),
  ).toVar();
  const gradients = (at: THREE.Node<"vec2">) =>
    [dFdx(at).toVar(), dFdy(at).toVar()] as const;
  const [tx, ty] = gradients(tiled);
  const [mx, my] = gradients(turned);
  const [rx, ry] = gradients(raked);
  const patch = vertexStage(
    mx_noise_float(world.mul(gravelPatchScale).add(2.1)),
  ).toVar();
  const shaded = Fn(() => {
    const colour = vec3(0).toVar();
    const cover = float(0).toVar();
    const relief = float(0).toVar();
    const roughness = float(gravelRoughDeep).toVar();
    If(field.greaterThan(gravelReach), () => {
      const stones = texture(maps.albedo, tiled).grad(tx, ty).rgb;
      const height = texture(maps.height, tiled)
        .grad(tx, ty)
        .r.sub(gravelHeightMean)
        .div(gravelHeightSpread)
        .clamp(-1.5, 1.5);
      const macro = texture(maps.albedo, turned)
        .grad(mx, my)
        .rgb.dot(vec3(1 / 3))
        .div(gravelMean);
      const furrow = texture(maps.streaks, raked).grad(rx, ry).r.sub(0.5);
      const crevice = float(1).add(height.mul(gravelCrevice)).clamp(0.45, 1.25);
      const tone = mix(float(1), macro, gravelMacroStrength)
        .mul(float(1).add(furrow.mul(gravelFurrowTone)))
        .mul(float(1).add(patch.mul(gravelPatchTone)))
        .mul(crevice);
      const edge = field
        .add(height.mul(gravelScatter))
        .add(macro.sub(1).mul(gravelEdgeWobble));
      const width = fwidth(field).max(0.02);
      colour.assign(stones.mul(gravelTint).mul(tone));
      cover.assign(
        smoothstep(float(0.5).sub(width), float(0.5).add(width), edge),
      );
      relief.assign(
        height.mul(gravelRelief).add(furrow.mul(gravelFurrowDepth)),
      );
      roughness.assign(
        mix(
          float(gravelRoughDeep),
          float(gravelRoughTop),
          smoothstep(-1, 1, height),
        ),
      );
    });
    return gravelResult(colour, cover, relief, roughness);
  })();
  return {
    colour: shaded.get("colour") as ColourNode,
    cover: shaded.get("cover") as FloatNode,
    relief: shaded.get("relief") as FloatNode,
    roughness: shaded.get("roughness") as FloatNode,
  };
}

export interface AsphaltDetail {
  tone: FloatNode;
  roughness: FloatNode;
  mottle: FloatNode;
}

export function screenBump(
  height: FloatNode,
  scale: number,
): THREE.Node<"vec3"> {
  const slopeX = dFdx(height).mul(scale);
  const slopeY = dFdy(height).mul(scale);
  const sigmaX = dFdx(positionView).normalize();
  const sigmaY = dFdy(positionView).normalize();
  const r1 = sigmaY.cross(normalView);
  const r2 = normalView.cross(sigmaX);
  const det = sigmaX.dot(r1).mul(faceDirection);
  const gradient = det.sign().mul(slopeX.mul(r1).add(slopeY.mul(r2)));
  return det.abs().mul(normalView).sub(gradient).normalize();
}

export function asphaltDetail(
  grain: THREE.Texture,
  cracked = true,
): AsphaltDetail {
  const lateral = uv().x.mul(asphaltTile);
  const along = uv().y.mul(asphaltTile);
  const world = positionWorld.xy;
  const blotch = vertexStage(
    mx_noise_float(world.mul(blotchScale).add(0.5)),
  ).mul(blotchStrength);
  const mottle = mx_noise_float(world.mul(mottleScale).add(3.3));
  const coarse = texture(grain, vec2(uv().y, uv().x.negate()).mul(coarseScale))
    .rgb.dot(vec3(1 / 3))
    .div(0.0152);
  const { inside, seam } = patches(lateral, along);
  const crack = cracked ? cracks(lateral, along) : float(0);
  const tone = float(1)
    .add(blotch)
    .add(mottle.mul(mottleStrength))
    .mul(mix(float(1), coarse, coarseContrast))
    .mul(mix(float(1), float(patchTone), inside))
    .mul(float(1).sub(seam.mul(0.35)))
    .mul(mix(float(1), float(crackTone), crack));
  return {
    tone,
    roughness: mix(float(1), float(crackRoughness / 0.8), crack),
    mottle,
  };
}

export function shadeKerb(
  material: THREE.MeshStandardNodeMaterial,
  grain: THREE.Texture,
): void {
  const across = uv().x;
  const along = uv().y;
  const phase = fract(along);
  const white = aa(float(kerbBlock), phase).mul(
    float(1).sub(aa(float(1 - 0.004), phase)),
  );
  const groove = float(1)
    .sub(smoothstep(0, kerbGroove, phase.sub(kerbBlock).abs()))
    .max(
      float(1).sub(smoothstep(0, kerbGroove, phase.min(float(1).sub(phase)))),
    );
  const concrete = texture(
    grain,
    uv().mul(vec2(kerbWidth, kerbTile)).mul(kerbGrainScale),
  )
    .rgb.dot(vec3(1 / 3))
    .div(0.0152);
  const speck = mix(float(1), concrete, kerbGrain);
  const streak = mx_noise_float(vec2(across.mul(9), along.mul(1.6)).add(4.4))
    .mul(0.5)
    .add(0.5);
  const ridden = float(1).sub(smoothstep(0.15, 0.75, across));
  const rubber = smoothstep(0.45, 0.85, streak.add(ridden.mul(0.35))).mul(
    ridden.mul(0.8).add(0.2),
  );
  const seam = float(1).sub(smoothstep(0, kerbSeam, across));
  const foot = float(1).sub(smoothstep(kerbFoot * 0.4, kerbFoot, across));
  const face = smoothstep(1, 1 + kerbFace, across);
  const joint = smoothstep(1 - kerbJoint, 1, across);
  const paint = mix(kerbRed, kerbWhite, white).mul(speck);
  const marked = mix(paint, paint.mul(1 - kerbRubber), rubber);
  const top = marked
    .mul(float(1).sub(seam.mul(0.35)))
    .mul(float(1).sub(groove.mul(0.4)))
    .mul(float(1).sub(foot.mul(kerbFootShade)))
    .mul(float(1).sub(joint.mul(1 - kerbJointShade)));
  material.colorNode = mix(
    top,
    mix(paint.mul(kerbFaceShade), kerbFaceGrime, 0.5),
    face,
  );
  material.roughnessNode = mix(
    mix(float(kerbPaintRoughness), float(kerbRubberRoughness), rubber),
    float(kerbFaceRoughness),
    face,
  );
  const height = groove
    .mul(kerbGrooveDepth)
    .negate()
    .add(concrete.mul(kerbGrainDepth));
  material.normalNode = screenBump(height, 1);
}

export function lushGrass(photo: ColourNode, share: FloatNode): ColourNode {
  const luminance = dot(photo, vec3(0.2126, 0.7152, 0.0722));
  const lush = lushGreen.mul(luminance.div(lushLuminance).clamp(0.7, 1.35));
  const growing = smoothstep(0.004, 0.02, photo.g.sub(photo.b)).max(share);
  const patches = mx_noise_float(positionWorld.xy.mul(patchScale).add(7.7));
  const tufts = mx_noise_float(positionWorld.xy.mul(tuftScale).add(1.9));
  const dry = smoothstep(0.35, 0.8, patches).mul(lushDryShare);
  const tinted = mix(lush, lush.mul(lushDryTint), dry).mul(
    tufts.mul(tuftStrength).add(1),
  );
  return mix(photo, tinted, growing.mul(lushShare).max(share));
}

export interface Turf {
  colour: ColourNode;
  relief: FloatNode;
}

export function turf(
  map: THREE.Texture,
  photo: ColourNode,
  layered = true,
): Turf {
  const world = positionWorld.xy;
  const first = texture(map, world.div(turfTile)).rgb;
  const ground = dot(photo, vec3(0.2126, 0.7152, 0.0722))
    .div(photoMean)
    .clamp(0.7, 1.3);
  let blades: ColourNode = first;
  if (layered) {
    const c = Math.cos(turfSecondAngle);
    const s = Math.sin(turfSecondAngle);
    const second = texture(
      map,
      vec2(
        world.x.mul(c).sub(world.y.mul(s)),
        world.x.mul(s).add(world.y.mul(c)),
      ).div(turfSecondTile),
    ).rgb;
    blades = mix(first, second, smoothstep(0.85, 1.15, ground));
  }
  const lift = blades.dot(vec3(1 / 3)).div(turfMean);
  const dry = vertexStage(
    smoothstep(0.3, 0.85, mx_noise_float(world.mul(dryScale).add(7.7))),
  ).mul(dryShare);
  const colour = blades
    .mul(turfTint)
    .mul(mix(vec3(1), dryTint, dry))
    .mul(mix(float(1), ground, photoShare))
    .mul(mix(float(1 - turfCrevice), float(1), lift.clamp(0, 1.4)));
  return { colour, relief: lift.mul(turfRelief) };
}

function stripes(coordinate: FloatNode): FloatNode {
  const band = fract(coordinate.div(mowWidth * 2));
  const edge = fwidth(coordinate.div(mowWidth * 2)).max(1e-4);
  const light = smoothstep(
    float(0.5).sub(edge),
    float(0.5).add(edge),
    band,
  ).sub(smoothstep(float(1).sub(edge), float(1), band));
  const fade = float(1).sub(smoothstep(0.08, 0.3, edge));
  return float(1).add(
    light
      .sub(0.5)
      .mul(mowStrength * 2)
      .mul(fade),
  );
}

export function mownAlong(lateral: FloatNode): FloatNode {
  return stripes(lateral);
}

export function mownWorld(): FloatNode {
  const across = positionWorld.x
    .mul(Math.cos(terrainMowAngle))
    .add(positionWorld.y.mul(Math.sin(terrainMowAngle)));
  return stripes(across);
}
