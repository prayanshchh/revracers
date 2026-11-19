import * as THREE from "three/webgpu";
import {
  fitSkyAmbient,
  setAmbientOvercast,
  useNightAmbient,
} from "./sky-ambient.ts";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import {
  asin,
  atan,
  exp,
  float,
  floor,
  Fn,
  fract,
  fwidth,
  If,
  max,
  min,
  mix,
  modelViewProjection,
  mx_fractal_noise_float,
  mx_worley_noise_float,
  normalize,
  positionLocal,
  pow,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { expectDownloads } from "./asset-store.ts";
import { releaseOnceUploaded } from "./preload.ts";
import { alphaTestedOrder } from "./road.ts";
import type { DayLook, NightLook, SkyLook } from "./circuits.ts";
import { sessionLight } from "./daylight.ts";
import { prime, primed } from "./prime.ts";
import { picturePixels, type SkyTexels } from "./sky-pack.ts";

const skyFiles = import.meta.glob<string>(
  "../../../../content/tracks/hill-country/sky/*.hdr",
  { query: "?url", import: "default", eager: true },
);
const skyMetas = import.meta.glob<SkyMeta>(
  "../../../../content/tracks/hill-country/sky/*.json",
  { import: "default", eager: true },
);

const domeRadius = 20000;
const sunPeak = 200;
const skySaturation = 0.78;
const skyGain = 1.25;
const sunShare = 3.5;
const lowSunSine = 0.49;
const targetMidtone = 1.24;
const maxExposure = 6;
export const skyNames = [
  "circuit",
  "dawn",
  "morning",
  "noon",
  "afternoon",
  "dusk",
  "late",
  "night",
] as const;
const skyGrades: Partial<Record<string, [number, number, number]>> = {
  dawn: [0.82, 0.95, 1.13],
  dusk: [0.72, 1, 1],
};
const nightElevation = (-8 * Math.PI) / 180;
const skyExposures: Partial<Record<string, number>> = {
  dawn: 0.7,
  night: 0.3,
  late: 1.15,
};
const overcastLevel = 1.2;
const overcastZenith = 0.68;
const overcastGround = 0.8;
const overcastTint = new THREE.Vector3(0.93, 0.96, 1.0);
const overcastEnvGround = 0.55;
const envStep = 0.04;
const cloudScale = 1.4;
const cloudContrast = 0.16;
const cloudMassScale = 0.35;
const cloudMassContrast = 0.42;
const cloudHorizon = 0.18;
const cloudDrift = 0.004;
const cumulusSilver = 1.2;
const photoCloudy = 0.4;
const sunFrom = 4;
const milkMost = 0.92;
const milkTint = [1.0, 0.97, 0.9] as const;
const sunTo = 20;
const manyCover = 0.65;
const fairBase = 1.6;
const fairScale = 0.9;
const fairDrift = 0.004;
const fairClear = 0.15;
const fairCrowded = -0.25;
const fairEdge = 0.2;
const fairCore = 0.45;
const fairCells = 1.6;
const fairJitter = 0.85;
const fairDetail = 2.6;
const fairErosion = 0.4;
const fairClusters = 0.08;
const fairClustering = 0.7;
const fairLit = 1.65;
const fairShade = 0.6;
const fairShadeShare = 0.92;
const fairSmall = 2.7;
const fairSmallShare = 0.85;
const fairUnder = 0.25;
const fairBaseEdge = 0.12;
const fairBaseShade = 0.75;
const fairBacklitFrom = 0.6;
const fairBacklit = 0.85;
const fairRim = 0.3;
const fairSight = 60;
const fairAspect = 0.45;
const fairBlurFrom = 0.08;
const fairBlurTo = 0.4;
const fairLow = 0.15;
const fairHigh = 0.5;
const clearTint = new THREE.Vector3(0.41, 1.08, 1.28);
const clearHaze = new THREE.Vector3(0.95, 1.42, 0.7);
const hazeTint = new THREE.Vector3(0.82, 1.2, 1.72);
const hazeAloft = new THREE.Vector3(0.29, 0.85, 1.75);
const hazeRise = 0.35;
const nightZenith = new THREE.Vector3(0.0012, 0.0036, 0.0115);
const nightHorizon = new THREE.Vector3(0.011, 0.017, 0.028);
const nightGlow = new THREE.Vector3(0.022, 0.024, 0.026);
const nightGlowHeight = 0.07;
const nightGround = new THREE.Vector3(0.05, 0.05, 0.047);
const nightCloudLevel = 0.03;
const nightExposure = 1;
const lampCells = 40;
const lampLow = 0.12;
const lampHigh = 0.7;
const lampSpread = 0.007;
const lampRadiance = 60;

export interface SkyMeta {
  elevation: number;
  azimuth: number;
  keepTop: number;
  skyRadiance: number[];
  horizon: number[];
  sunColor: number[];
  clouds?: number;
  encoding?: SkyEncoding;
}

interface SkyEncoding {
  scale: number;
  gamma: number;
}

export interface CompactSky {
  name: string;
  dome: string;
  env: string;
  meta: string;
}

const encodedLimit = 0.999;

function encodedRadiance(level: number, encoding: SkyEncoding): number {
  const t = Math.min((level / 255) ** encoding.gamma, encodedLimit);
  return (encoding.scale * t) / (1 - t);
}

async function decodedSky(
  url: string,
  encoding: SkyEncoding,
): Promise<THREE.DataTexture> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to load ${url}`);
  const { pixels, width, height } = await picturePixels(await response.blob());
  const table = Uint16Array.from({ length: 256 }, (_, level) =>
    THREE.DataUtils.toHalfFloat(
      Math.min(encodedRadiance(level, encoding), 65504),
    ),
  );
  const one = THREE.DataUtils.toHalfFloat(1);
  const data = new Uint16Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = table[pixels[i] ?? 0] ?? 0;
    data[i + 1] = table[pixels[i + 1] ?? 0] ?? 0;
    data[i + 2] = table[pixels[i + 2] ?? 0] ?? 0;
    data[i + 3] = one;
  }
  return radianceMap(data, width, height);
}

function radianceMap(
  data: Uint16Array,
  width: number,
  height: number,
): THREE.DataTexture {
  const map = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  map.colorSpace = THREE.LinearSRGBColorSpace;
  map.minFilter = THREE.LinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = false;
  map.flipY = true;
  map.needsUpdate = true;
  return map;
}

function skyTexelsOf(picture: Blob): Promise<SkyTexels> {
  const worker = new Worker(new URL("./sky-worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<SkyTexels>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<SkyTexels | null>) => {
      if (event.data) resolve(event.data);
      else reject(new Error("the sky picture could not be decoded"));
    };
    worker.onerror = () => {
      reject(new Error("the sky decoder could not start"));
    };
    worker.postMessage(picture);
  }).finally(() => {
    worker.terminate();
  });
}

async function packedDome(url: string): Promise<THREE.DataTexture> {
  const manager = THREE.DefaultLoadingManager;
  manager.itemStart(url);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`failed to load ${url}`);
    const { data, width, height } = await skyTexelsOf(await response.blob());
    return radianceMap(data, width, height);
  } finally {
    manager.itemEnd(url);
  }
}

function unseenDome(): THREE.DataTexture {
  const map = new THREE.DataTexture(
    new Uint16Array(4),
    1,
    1,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  map.colorSpace = THREE.LinearSRGBColorSpace;
  map.needsUpdate = true;
  return map;
}

function domeSeen(name: string, night: number): boolean {
  return night >= 1 || (metaOf(name).clouds ?? 0) <= photoCloudy;
}

function domeOf(url: string, loader: HDRLoader): Promise<THREE.DataTexture> {
  return url.endsWith(".webp") ? packedDome(url) : loader.loadAsync(url);
}

function skyKey(url: string): string {
  return `sky:${url}`;
}

function skyPicture(
  url: string,
  loader: HDRLoader,
): Promise<THREE.DataTexture> {
  return primed(skyKey(url), () => domeOf(url, loader));
}

export function skyPrimes(hours: number): string[] {
  return skyFor(hours).map(skyKey);
}

export function primeSky(hours: number): void {
  const loader = new HDRLoader();
  for (const url of skyFor(hours))
    prime(
      skyKey(url),
      () => domeOf(url, loader),
      (map) => {
        map.dispose();
      },
    );
}

async function skyTextures(
  compact: CompactSky | null,
  elevation: number,
  afternoon: boolean,
  night: number,
): Promise<{
  name: string;
  meta: SkyMeta;
  sky: THREE.Texture;
  clearSky: THREE.Texture;
  environment: THREE.Texture;
}> {
  if (compact) {
    const meta = (await (await fetch(compact.meta)).json()) as SkyMeta;
    const encoding = meta.encoding ?? { scale: 1, gamma: 1 };
    const [sky, environment] = await Promise.all([
      decodedSky(night >= 1 ? compact.env : compact.dome, encoding),
      decodedSky(compact.env, encoding),
    ]);
    return { name: compact.name, meta, sky, clearSky: sky, environment };
  }
  const { name, meta } = chooseSky(elevation, afternoon);
  const loader = new HDRLoader();
  const clearUrl = fileUrl(`${name}-clear.hdr`);
  const envUrl = fileUrl(`${name}-env.hdr`);
  const domeUrl = domeSeen(name, night)
    ? fileUrl(night >= 1 ? `${name}-env.hdr` : `${name}.hdr`)
    : null;
  expectDownloads(domeUrl ? [domeUrl, clearUrl, envUrl] : [clearUrl, envUrl]);
  const [sky, clearSky, environment] = await Promise.all([
    domeUrl ? skyPicture(domeUrl, loader) : unseenDome(),
    skyPicture(clearUrl, loader),
    skyPicture(envUrl, loader),
  ]);
  return { name, meta, sky, clearSky, environment };
}

function graded(meta: SkyMeta, grade: THREE.Vector3): SkyMeta {
  const scale = (v: number[]) => v.map((x, i) => x * grade.getComponent(i));
  const sun = scale(meta.sunColor);
  const brightest = Math.max(...sun);
  return {
    ...meta,
    skyRadiance: scale(meta.skyRadiance),
    horizon: scale(meta.horizon),
    sunColor: sun.map((x) => x / brightest),
  };
}

function fileUrl(name: string): string {
  const entry = Object.entries(skyFiles).find(([key]) =>
    key.endsWith(`/${name}`),
  );
  if (!entry) throw new Error(`missing sky asset ${name}`);
  return entry[1];
}

export function skyDownloads(names: string[]): string[] {
  return names.flatMap((name) => [
    ...(domeSeen(name, 0) ? [fileUrl(`${name}.hdr`)] : []),
    fileUrl(`${name}-clear.hdr`),
    fileUrl(`${name}-env.hdr`),
  ]);
}

export function skyFor(hours: number): string[] {
  const light = sessionLight(hours);
  const { name } = chooseSky(light.elevation, light.afternoon);
  const lights = [fileUrl(`${name}-clear.hdr`), fileUrl(`${name}-env.hdr`)];
  return light.night < 1 && domeSeen(name, light.night)
    ? [fileUrl(`${name}.hdr`), ...lights]
    : lights;
}

function metaOf(name: string): SkyMeta {
  const entry = Object.entries(skyMetas).find(([key]) =>
    key.endsWith(`/${name}.json`),
  );
  if (!entry) throw new Error(`missing sky asset ${name}.json`);
  return entry[1];
}

function chooseSky(
  elevation: number,
  afternoon: boolean,
): { name: string; meta: SkyMeta } {
  const metas = skyNames.map((name) => ({ name, meta: metaOf(name) }));
  const fits = (name: string) => {
    if (elevation < nightElevation) return name === "night";
    if (name === "night") return false;
    if (name === "dawn" || name === "morning") return !afternoon;
    if (["afternoon", "dusk", "late"].includes(name)) return afternoon;
    return true;
  };
  const usable = metas.filter((sky) => fits(sky.name));
  return usable.reduce((best, sky) =>
    Math.abs(sky.meta.elevation - elevation) <
    Math.abs(best.meta.elevation - elevation)
      ? sky
      : best,
  );
}

export class SkyBox {
  readonly mesh: THREE.Mesh;
  readonly environmentRotation = new THREE.Euler();
  readonly overcast = uniform(0);
  readonly overcastLight = uniform(1);
  readonly cloudTime = uniform(0);
  readonly broken = uniform(0);
  private readonly sunAt = uniform(new THREE.Vector3(0, 0, 1));
  readonly night: THREE.UniformNode<"float", number>;
  private readonly kappa = uniform(0);
  readonly tint = uniform(clearTint.clone());
  readonly haze = uniform(clearHaze.clone());
  readonly veilLow = uniform(hazeTint.clone());
  readonly veilHigh = uniform(hazeAloft.clone());
  readonly photoTint = uniform(new THREE.Vector3(1, 1, 1));
  readonly milk = uniform(0);
  readonly milkLift = uniform(0);
  readonly milkPower = uniform(1);
  private readonly rotation = new THREE.Matrix4();
  private readonly nightZenith: THREE.Vector3;
  private readonly nightHorizon: THREE.Vector3;
  private readonly nightGlow: THREE.Vector3;
  private readonly nightDome: number;

  readonly environment: THREE.Texture;
  private readonly envOvercast = uniform(0);
  private readonly envLight = uniform(1);
  private readonly envBlend: THREE.QuadMesh;
  private readonly envTarget: THREE.RenderTarget;
  private envShown = -1;
  private envLightShown = -1;

  private constructor(
    private readonly sky: THREE.Texture,
    private readonly clearSky: THREE.Texture,
    clearEnvironment: THREE.Texture,
    readonly meta: SkyMeta,
    private readonly exposureScale: number,
    private readonly nightShare: number,
    private readonly grade: THREE.Vector3,
    look: NightLook | null = null,
    readonly day: SkyLook | null = null,
  ) {
    if (day) {
      this.tint.value.set(...day.tint);
      this.haze.value.set(...day.haze);
      this.veilLow.value.set(...day.veil);
      this.veilHigh.value.set(...day.aloft);
      this.photoTint.value.set(...day.photo);
      [this.milk.value, this.milkLift.value, this.milkPower.value] = day.milk;
    }
    this.night = uniform(nightShare);
    this.nightZenith = look ? new THREE.Vector3(...look.zenith) : nightZenith;
    this.nightHorizon = look
      ? new THREE.Vector3(...look.horizon)
      : nightHorizon;
    this.nightGlow = look ? new THREE.Vector3(...look.glow) : nightGlow;
    this.nightDome = look ? look.dome : 1;
    const { width, height } = clearEnvironment.image as {
      width: number;
      height: number;
    };
    this.envTarget = new THREE.RenderTarget(width, height, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
    this.environment = this.envTarget.texture;
    this.environment.mapping = THREE.EquirectangularReflectionMapping;
    this.environment.colorSpace = THREE.LinearSRGBColorSpace;
    const blend = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
    });
    const up = uv().y.sub(0.5).mul(Math.PI).sin();
    const tint = vec3(grade.x, grade.y, grade.z);
    const clearLight = texture(clearEnvironment, uv()).rgb.mul(tint);
    const overcastLight = mix(
      clearLight.mul(overcastEnvGround),
      vec3(overcastTint.x, overcastTint.y, overcastTint.z)
        .mul(this.overcastLevelAt(up))
        .mul(this.horizonLevel),
      smoothstep(-0.05, 0.02, up),
    );
    const dayLight = mix(
      clearLight,
      overcastLight.mul(this.envLight),
      this.envOvercast,
    );
    blend.colorNode =
      nightShare > 0
        ? mix(dayLight, this.nightEnvironment(up), this.night)
        : dayLight;
    this.envBlend = new THREE.QuadMesh(blend);
    const material = new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      depthWrite: false,
    });
    const clip = modelViewProjection as unknown as THREE.Node<"vec4">;
    material.vertexNode = vec4(clip.xy, 0, clip.w);
    const shown = this.radiance(normalize(positionLocal));
    material.colorNode =
      this.nightDome === 1
        ? shown
        : shown.mul(mix(float(1), float(this.nightDome), this.night));
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(domeRadius, 64, 32),
      material,
    );
    this.mesh.renderOrder = alphaTestedOrder + 1;
    this.mesh.frustumCulled = false;
  }

  private get horizonLevel(): number {
    const [hr = 1, hg = 1, hb = 1] = this.meta.horizon;
    const day =
      (0.2126 * hr + 0.7152 * hg + 0.0722 * hb) * skyGain * overcastLevel;
    return day + (nightCloudLevel - day) * this.nightShare;
  }

  private nightSky(up: THREE.Node<"float">): THREE.Node<"vec3"> {
    const above = up.max(0);
    const gradient = mix(
      vec3(this.nightHorizon.x, this.nightHorizon.y, this.nightHorizon.z),
      vec3(this.nightZenith.x, this.nightZenith.y, this.nightZenith.z),
      smoothstep(0, 0.6, above),
    );
    const glow = vec3(this.nightGlow.x, this.nightGlow.y, this.nightGlow.z).mul(
      exp(above.div(nightGlowHeight).negate()),
    );
    return mix(
      vec3(nightGround.x, nightGround.y, nightGround.z).mul(0.2),
      gradient.add(glow),
      smoothstep(-0.03, 0.0, up),
    );
  }

  private nightEnvironment(up: THREE.Node<"float">): THREE.Node<"vec3"> {
    const cell = uv().x.mul(lampCells);
    const id = floor(cell);
    const seed = fract(sin(id.mul(12.9898)).mul(43758.5453));
    const height = mix(float(lampLow), float(lampHigh), seed);
    const across = fract(cell)
      .sub(0.5)
      .mul((2 * Math.PI) / lampCells)
      .mul(height.cos());
    const rise = uv().y.sub(0.5).mul(Math.PI).sub(height);
    const lamp = exp(
      across
        .mul(across)
        .add(rise.mul(rise))
        .div(-2 * lampSpread * lampSpread),
    ).mul(lampRadiance);
    const ground = vec3(nightGround.x, nightGround.y, nightGround.z);
    const sky = this.nightSky(up);
    return mix(ground, sky, smoothstep(-0.05, 0.02, up)).add(
      vec3(1, 0.96, 0.9).mul(lamp),
    );
  }

  private overcastLevelAt(up: THREE.Node<"float">): THREE.Node<"float"> {
    return mix(float(1), float(overcastZenith), smoothstep(0, 0.85, up)).mul(
      mix(float(overcastGround), float(1), smoothstep(-0.05, 0.02, up)),
    );
  }

  refreshEnvironment(
    renderer: THREE.WebGPURenderer,
    overcast: number,
    light: number,
  ): void {
    const level = Math.round(overcast / envStep) * envStep;
    const shade = Math.round(light / envStep) * envStep;
    if (level === this.envShown && shade === this.envLightShown) return;
    this.envShown = level;
    this.envLightShown = shade;
    this.envOvercast.value = level;
    this.envLight.value = shade;
    if (this.nightShare > 0)
      useNightAmbient(this.nightAmbient(true), this.nightAmbient(false));
    setAmbientOvercast(level, this.horizonLevel * shade);
    const previous = renderer.getRenderTarget();
    const { toneMapping, outputColorSpace } = renderer;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setRenderTarget(this.envTarget);
    this.envBlend.render(renderer);
    renderer.setRenderTarget(previous);
    renderer.toneMapping = toneMapping;
    renderer.outputColorSpace = outputColorSpace;
    this.environment.needsPMREMUpdate = true;
  }

  renewEnvironment(): void {
    this.environment.needsPMREMUpdate = true;
  }

  private nightAmbient(upward: boolean): THREE.Color {
    const sky = upward ? this.nightHorizon : nightGround;
    const share = this.nightShare * Math.PI * (upward ? 1 : 0.5);
    return new THREE.Color(sky.x * share, sky.y * share, sky.z * share);
  }

  radiance(direction: THREE.Node<"vec3">, detailed = true): THREE.Node<"vec3"> {
    const day = this.dayRadiance(direction, detailed);
    if (this.nightShare <= 0) return day;
    return mix(day, this.nightSky(direction.z), this.night);
  }

  private dayRadiance(
    direction: THREE.Node<"vec3">,
    detailed: boolean,
  ): THREE.Node<"vec3"> {
    const u = fract(
      this.kappa
        .sub(atan(direction.y, direction.x))
        .div(2 * Math.PI)
        .add(0.5),
    );
    const fromTop = float(0.5).sub(asin(direction.z).div(Math.PI));
    const v = float(1).sub(fromTop.div(this.meta.keepTop));
    const grade = vec3(this.grade.x, this.grade.y, this.grade.z);
    const photoCloud = (this.meta.clouds ?? 0) > photoCloudy;
    const radiance = photoCloud
      ? this.photoSky(u, v, direction, detailed)
      : this.tintedPhoto(min(texture(this.sky, vec2(u, v)).rgb, vec3(sunPeak)));
    const graded = radiance.mul(grade);
    const grey = graded.dot(vec3(0.2126, 0.7152, 0.0722));
    const clear = mix(vec3(grey), graded, skySaturation).mul(skyGain);
    const gradient = this.overcastLevelAt(direction.z);
    const plane = direction.xy
      .div(max(direction.z, 0.06))
      .mul(cloudScale)
      .add(vec2(this.cloudTime.mul(cloudDrift), 0))
      .toVar();
    const masses = mx_fractal_noise_float(
      vec3(plane.mul(cloudMassScale), this.cloudTime.mul(0.001)),
      2,
    );
    const clouds = detailed
      ? float(1).add(
          mx_fractal_noise_float(vec3(plane, this.cloudTime.mul(0.002)), 3)
            .mul(cloudContrast)
            .add(masses.mul(cloudMassContrast))
            .mul(smoothstep(-0.02, cloudHorizon, direction.z)),
        )
      : float(1);
    const cloudy = vec3(overcastTint.x, overcastTint.y, overcastTint.z).mul(
      gradient.mul(clouds).mul(this.horizonLevel).mul(this.overcastLight),
    );
    if (!detailed) return mix(clear, cloudy, this.overcast);
    const towardSun = direction.dot(this.sunAt).mul(0.5).add(0.5).toVar();
    return Fn(() => {
      const result = clear.toVar();
      if (!photoCloud)
        If(this.broken.greaterThan(0), () => {
          result.assign(this.fairWeather(result, direction, towardSun));
        });
      If(this.overcast.greaterThan(0), () => {
        result.assign(mix(result, cloudy, this.overcast));
      });
      return result;
    })();
  }

  private tintedPhoto(photo: THREE.Node<"vec3">): THREE.Node<"vec3"> {
    const level = photo.dot(vec3(0.2126, 0.7152, 0.0722));
    return mix(
      photo.mul(this.photoTint),
      photo,
      smoothstep(sunFrom, sunTo, level),
    );
  }

  private photoSky(
    u: THREE.Node<"float">,
    v: THREE.Node<"float">,
    direction: THREE.Node<"vec3">,
    detailed: boolean,
  ): THREE.Node<"vec3"> {
    const up = direction.z;
    const at = vec2(u, v).toVar();
    const clear = texture(this.clearSky, at).rgb.toVar();
    const tinted = clear.mul(this.tint);
    const hazed = exp(up.max(0).div(this.haze.z).negate()).mul(this.haze.x);
    const [hr = 1, hg = 1, hb = 1] = this.meta.horizon;
    const veil = mix(
      this.veilLow,
      this.veilHigh,
      up.div(hazeRise).clamp(0, 1),
    ).mul(this.haze.y.mul(0.2126 * hr + 0.7152 * hg + 0.0722 * hb));
    const hazy = mix(tinted, veil, hazed);
    const path = float(1).sub(this.sunAt.z.mul(this.sunAt.z));
    const lobe = pow(max(direction.dot(this.sunAt), 0), this.milkPower)
      .mul(this.milk)
      .mul(path.mul(path))
      .min(milkMost);
    const milky = vec3(hazy.dot(vec3(0.2126, 0.7152, 0.0722)))
      .mul(vec3(milkTint[0], milkTint[1], milkTint[2]))
      .mul(lobe.mul(this.milkLift).add(1));
    const blue = mix(hazy, milky, lobe).toVar();
    if (!detailed) return blue;
    const towardSun = direction.dot(this.sunAt).mul(0.5).add(0.5);
    return Fn(() => {
      const result = blue.toVar();
      If(this.broken.greaterThan(0), () => {
        result.assign(this.fairWeather(result, direction, towardSun));
      });
      return result;
    })();
  }

  private fairWeather(
    clear: THREE.Node<"vec3">,
    direction: THREE.Node<"vec3">,
    towardSun: THREE.Node<"float">,
  ): THREE.Node<"vec3"> {
    const rise = direction.z.max(0);
    const lifted = rise.div(fairAspect);
    const reach = float((2 * fairBase) / fairAspect).div(
      lifted.add(lifted.mul(lifted).add(1).sqrt()),
    );
    const sight = float(fairBase).div(rise.max(0.015));
    const spot = direction.xy
      .mul(reach)
      .add(vec2(this.cloudTime.mul(fairDrift), 0))
      .mul(fairScale);
    const large = float(1).sub(
      mx_worley_noise_float(spot.mul(fairCells), fairJitter),
    );
    const under = float(1).sub(
      mx_worley_noise_float(
        spot.add(direction.xy.normalize().mul(fairUnder)).mul(fairCells),
        fairJitter,
      ),
    );
    const puffs = large.max(
      float(fairSmallShare).sub(
        mx_worley_noise_float(spot.mul(fairSmall).add(3.1), fairJitter),
      ),
    );
    const erosion = mx_fractal_noise_float(
      vec3(spot.mul(fairDetail), this.cloudTime.mul(0.0004)),
      4,
    );
    const clusters = mx_fractal_noise_float(
      vec3(spot.mul(fairClusters), 7.3),
      2,
    );
    const shape = puffs
      .add(erosion.mul(fairErosion))
      .add(clusters.mul(fairClustering))
      .sub(0.55);
    const crowd = this.broken.div(manyCover).clamp(0, 1);
    const threshold = mix(float(fairClear), float(fairCrowded), crowd);
    const blur = smoothstep(
      fairBlurFrom,
      fairBlurTo,
      fwidth(spot.x).add(fwidth(spot.y)),
    );
    const density = mix(
      smoothstep(threshold, threshold.add(fairEdge), shape),
      mix(float(fairLow), float(fairHigh), crowd),
      blur,
    );
    const core = smoothstep(threshold, threshold.add(fairCore), shape);
    const [hr = 1, hg = 1, hb = 1] = this.meta.horizon;
    const horizon = vec3(hr, hg, hb).mul(skyGain);
    const [sr = 1, sg = 1, sb = 1] = this.meta.sunColor;
    const lit = horizon.mul(fairLit).mul(mix(vec3(1), vec3(sr, sg, sb), 0.5));
    const shade = horizon.mul(fairShade).mul(vec3(0.92, 0.95, 1.0));
    const base = smoothstep(0, fairBaseEdge, large.sub(under));
    const backlit = smoothstep(fairBacklitFrom, 1, towardSun);
    const rim = float(1)
      .sub(smoothstep(threshold, threshold.add(fairRim), shape))
      .mul(backlit);
    const cloud = mix(
      lit,
      shade,
      core
        .mul(fairShadeShare)
        .max(base.mul(fairBaseShade))
        .max(backlit.mul(fairBacklit)),
    ).mul(rim.mul(cumulusSilver).add(1));
    const shown = density
      .mul(exp(sight.div(fairSight).negate()))
      .mul(smoothstep(0, 0.02, direction.z));
    return mix(clear, cloud, shown);
  }

  static async load(
    elevation: number,
    afternoon: boolean,
    night: number,
    compact: CompactSky | null = null,
    look: NightLook | null = null,
    day: DayLook | null = null,
  ): Promise<SkyBox> {
    const { name, meta, sky, clearSky, environment } = await skyTextures(
      compact,
      elevation,
      afternoon,
      night,
    );
    releaseOnceUploaded(sky);
    releaseOnceUploaded(clearSky);
    clearSky.wrapS = THREE.RepeatWrapping;
    clearSky.wrapT = THREE.ClampToEdgeWrapping;
    clearSky.minFilter = THREE.LinearFilter;
    clearSky.magFilter = THREE.LinearFilter;
    clearSky.generateMipmaps = false;
    sky.wrapS = THREE.RepeatWrapping;
    sky.wrapT = THREE.ClampToEdgeWrapping;
    sky.minFilter = THREE.LinearFilter;
    sky.magFilter = THREE.LinearFilter;
    sky.generateMipmaps = false;
    environment.mapping = THREE.EquirectangularReflectionMapping;
    const grade = new THREE.Vector3(...(skyGrades[name] ?? [1, 1, 1]));
    fitSkyAmbient(environment, grade);
    const box = new SkyBox(
      sky,
      clearSky,
      environment,
      graded(meta, grade),
      skyExposures[name] ?? 1,
      night,
      grade,
      look,
      day ? { ...day, ...day.skies[name] } : null,
    );
    return box;
  }

  get overcastHorizon(): THREE.Color {
    const level = this.horizonLevel;
    return new THREE.Color(
      overcastTint.x * level,
      overcastTint.y * level,
      overcastTint.z * level,
    );
  }

  get sunIntensity(): number {
    const radiance = this.meta.skyRadiance[1] ?? 0;
    const sine = Math.max(Math.sin(this.meta.elevation), 0);
    return (
      sunShare *
      Math.PI *
      radiance *
      Math.min(1 / sine, sine / lowSunSine ** 2) *
      (this.day?.sun ?? 1)
    );
  }

  get sunStrength(): number {
    return Math.min(1, Math.max(Math.sin(this.meta.elevation), 0) / lowSunSine);
  }

  get exposure(): number {
    const radiance = this.meta.skyRadiance[1] ?? 1;
    const day =
      Math.min(maxExposure, targetMidtone / ((1 + sunShare) * radiance)) *
      this.exposureScale *
      (this.day?.exposure ?? 1);
    return day + (nightExposure - day) * this.nightShare;
  }

  get airHaze(): THREE.Color {
    const [hr = 1, hg = 1, hb = 1] = this.meta.horizon;
    const [ar = 1, ag = 1, ab = 1] = this.day?.air ?? [];
    return new THREE.Color(hr * ar, hg * ag, hb * ab);
  }

  get scatter(): number {
    return this.nightShare >= 1 ? 0 : (this.day?.scatter ?? 0);
  }

  get iris(): readonly [number, number] {
    return this.nightShare >= 1 || !this.day ? [0, 0] : this.day.iris;
  }

  get glare(): number {
    return this.nightShare >= 1 ? 0 : (this.day?.glare ?? 0);
  }

  sight(fallback: number): number {
    return this.day?.visibility ?? fallback;
  }

  get nightHaze(): THREE.Color {
    const h = this.nightHorizon;
    return new THREE.Color(h.x, h.y, h.z);
  }

  update(sun: THREE.Vector3, eyeX: number, eyeY: number, scene: THREE.Scene) {
    this.sunAt.value.copy(sun);
    const kappa = this.meta.azimuth + Math.atan2(sun.y, sun.x);
    this.kappa.value = kappa;
    this.mesh.position.set(eyeX, eyeY, 0);
    const c = Math.cos(kappa);
    const s = Math.sin(kappa);
    this.rotation.set(c, 0, s, 0, -s, 0, c, 0, 0, -1, 0, 0, 0, 0, 0, 1);
    this.environmentRotation.setFromRotationMatrix(this.rotation);
    scene.environmentRotation.copy(this.environmentRotation);
  }
}
