import * as THREE from "three/webgpu";
import { float, mix, normalWorld, uniform, vec3 } from "three/tsl";

const rowStep = 4;
const columnStep = 8;
const channels = 4;
const irradianceUp = uniform(new THREE.Color());
const irradianceDown = uniform(new THREE.Color());
const clearUp = new THREE.Color();
const clearDown = new THREE.Color();
const overcastUp = new THREE.Color();
const overcastTint = new THREE.Color(0.93, 0.96, 1.0);
const overcastBounce = 0.15;
const overcastSpread = 0.78;
const floodUp = uniform(new THREE.Color());
const floodDown = uniform(new THREE.Color());
const flood: { cover: THREE.Node<"float"> | null } = { cover: null };
const canopyGain = 0.62;
const canopyFloor = 0.0125;

export function skyIrradiance(facing: THREE.Node<"float">): THREE.Node<"vec3"> {
  const sky = mix(irradianceDown, irradianceUp, facing);
  return flood.cover
    ? sky.add(mix(floodDown, floodUp, facing).mul(flood.cover))
    : sky;
}

export function floodlit(): boolean {
  return flood.cover !== null;
}

export function canopyLight(): THREE.Node<"float"> {
  return flood.cover ? flood.cover.mul(canopyGain).add(canopyFloor) : float(1);
}

class SkyAmbient extends THREE.LightingNode {
  override setup(builder: THREE.NodeBuilder): undefined {
    const context = builder.context as {
      iblIrradiance: THREE.Node<"vec3">;
    };
    context.iblIrradiance.addAssign(
      skyIrradiance(normalWorld.z.mul(0.5).add(0.5)),
    );
    return undefined;
  }
}

type DirectInput = Parameters<THREE.PhysicalLightingModel["direct"]>[0];

export class MatteLighting extends THREE.PhysicalLightingModel {
  constructor(private readonly gloss: THREE.Node<"float">) {
    super();
  }

  override direct(input: DirectInput, builder: THREE.NodeBuilder): void {
    const specular = input.reflectedLight
      .directSpecular as unknown as ReturnType<typeof vec3>;
    const before = vec3(0).toVar();
    before.assign(specular);
    super.direct(input, builder);
    specular.assign(mix(before, specular, this.gloss));
  }
}

export class SkyLitMaterial extends THREE.MeshStandardNodeMaterial {
  gloss: THREE.Node<"float"> | null = null;

  override setupEnvironment(): THREE.EnvironmentNode {
    return new SkyAmbient() as unknown as THREE.EnvironmentNode;
  }

  override setupLightingModel(): THREE.PhysicalLightingModel {
    return this.gloss
      ? new MatteLighting(this.gloss)
      : super.setupLightingModel();
  }
}

function addRow(
  target: THREE.Color,
  data: Uint16Array,
  row: number,
  width: number,
  weight: number,
): void {
  const half = (value: number | undefined) =>
    THREE.DataUtils.fromHalfFloat(value ?? 0);
  for (let column = 0; column < width; column += columnStep) {
    const at = (row * width + column) * channels;
    target.r += half(data[at]) * weight;
    target.g += half(data[at + 1]) * weight;
    target.b += half(data[at + 2]) * weight;
  }
}

export function fitSkyAmbient(
  environment: THREE.Texture,
  grade: THREE.Vector3,
): void {
  const { data, width, height } = environment.image as {
    data: Uint16Array;
    width: number;
    height: number;
  };
  irradianceUp.value.setRGB(0, 0, 0);
  irradianceDown.value.setRGB(0, 0, 0);
  const cell =
    ((Math.PI / height) * rowStep * (2 * Math.PI * columnStep)) / width;
  for (let row = 0; row < height; row += rowStep) {
    const angle = ((row + 0.5) / height) * Math.PI;
    const facing = Math.cos(angle) * Math.sin(angle) * cell;
    addRow(
      facing > 0 ? irradianceUp.value : irradianceDown.value,
      data,
      row,
      width,
      Math.abs(facing),
    );
  }
  const tint = new THREE.Color(grade.x, grade.y, grade.z);
  irradianceUp.value.multiply(tint);
  irradianceDown.value.multiply(tint);
  clearUp.copy(irradianceUp.value);
  clearDown.copy(irradianceDown.value);
}

export function setAmbientOvercast(amount: number, level: number): void {
  overcastUp
    .copy(overcastTint)
    .multiplyScalar(Math.PI * overcastSpread * level);
  irradianceUp.value.copy(clearUp).lerp(overcastUp, amount);
  irradianceDown.value
    .copy(clearDown)
    .lerp(overcastUp.multiplyScalar(overcastBounce), amount);
}

export function useNightAmbient(up: THREE.Color, down: THREE.Color): void {
  clearUp.copy(up);
  clearDown.copy(down);
  irradianceUp.value.copy(up);
  irradianceDown.value.copy(down);
}

export function useFloodAmbient(
  cover: THREE.Node<"float">,
  up: THREE.Color,
  down: THREE.Color,
): void {
  flood.cover = cover;
  floodUp.value.copy(up);
  floodDown.value.copy(down);
}
