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
  If,
  max,
  min,
  mix,
  modelViewProjection,
  mx_fractal_noise_float,
  mx_noise_float,
  normalize,
  positionLocal,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { expectDownloads, releaseOnceUploaded } from "./preload.ts";
import { alphaTestedOrder } from "./road.ts";
import type { NightLook } from "./circuits.ts";

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
const targetMidtone = 1.4;
const maxExposure = 6;
const skyNames = [
  "circuit",
  "dawn",
  "morning",
  "noon",
  "afternoon",
  "dusk",
  "night",
] as const;
const skyGrades: Partial<Record<string, [number, number, number]>> = {
  dawn: [0.82, 0.95, 1.13],
  dusk: [0.72, 1, 1],
};
const nightElevation = (-8 * Math.PI) / 180;
const skyExposures: Partial<Record<string, number>> = { dawn: 0.7, night: 0.3 };
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
const cumulusScale = 1.6;
const cumulusEdge = 0.1;
const cumulusCurve = 0.3;
const cumulusBase = 0.5;
const cumulusTop = 1.15;
const cumulusSilver = 0.45;
const photoCloudy = 0.4;
const scarceCover = 0.45;
const manyCover = 0.65;
const cloudSoft = 0.3;
const scarceThreshold = 0.05;
const fewRegionScale = 1.7;
const fewRegionShare = 0.15;
const maskFrom = 0.08;
const maskTo = 0.55;
const photoHorizonFrom = 0.01;
const photoHorizonTo = 0.06;
const clearTint = new THREE.Vector3(0.48, 1.25, 1.38);
const clearHaze = new THREE.Vector3(0.9, 2.4, 0.1);
const hazeTint = vec3(0.78, 0.95, 1.12);
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
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d canvas to decode the sky");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height).data;
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
  const dome = night >= 1 ? `${name}-env.hdr` : `${name}.hdr`;
  const [domeUrl, clearUrl, envUrl] = [
    fileUrl(dome),
    fileUrl(`${name}-clear.hdr`),
    fileUrl(`${name}-env.hdr`),
  ];
  expectDownloads([domeUrl, clearUrl, envUrl]);
  const [sky, clearSky, environment] = await Promise.all([
    loader.loadAsync(domeUrl),
    loader.loadAsync(clearUrl),
    loader.loadAsync(envUrl),
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
    fileUrl(`${name}.hdr`),
    fileUrl(`${name}-clear.hdr`),
    fileUrl(`${name}-env.hdr`),
  ]);
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
    if (name === "afternoon" || name === "dusk") return afternoon;
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
  private readonly rotation = new THREE.Matrix4();
  private readonly nightZenith: THREE.Vector3;
  private readonly nightHorizon: THREE.Vector3;
  private readonly nightGlow: THREE.Vector3;

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
  ) {
    this.night = uniform(nightShare);
    this.nightZenith = look ? new THREE.Vector3(...look.zenith) : nightZenith;
    this.nightHorizon = look
      ? new THREE.Vector3(...look.horizon)
      : nightHorizon;
    this.nightGlow = look ? new THREE.Vector3(...look.glow) : nightGlow;
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
    material.colorNode = this.radiance(normalize(positionLocal));
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
      : min(texture(this.sky, vec2(u, v)).rgb, vec3(sunPeak));
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
    const up = direction.z.toVar();
    const towardSun = direction.dot(this.sunAt).mul(0.5).add(0.5).toVar();
    return Fn(() => {
      const result = clear.toVar();
      if (!photoCloud)
        If(this.broken.greaterThan(0), () => {
          result.assign(this.cumulus(result, plane, up, towardSun));
        });
      If(this.overcast.greaterThan(0), () => {
        result.assign(mix(result, cloudy, this.overcast));
      });
      return result;
    })();
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
    const blue = mix(
      tinted,
      vec3(tinted.dot(vec3(0.2126, 0.7152, 0.0722)))
        .mul(this.haze.y)
        .mul(hazeTint),
      hazed,
    ).toVar();
    if (!detailed) return blue;
    const sunU = this.meta.azimuth / (2 * Math.PI) + 0.5;
    const near = smoothstep(photoHorizonFrom, photoHorizonTo, up);
    return Fn(() => {
      const result = blue.toVar();
      const keep = (photo: THREE.Node<"vec3">, show: THREE.Node<"float">) =>
        photo.mul(mix(this.tint, vec3(1), show));
      If(this.broken.greaterThan(0), () => {
        const photo = min(texture(this.sky, at).rgb, vec3(sunPeak));
        const cover = this.broken.div(scarceCover).clamp(0, 1);
        const region = smoothstep(
          fewRegionShare,
          fewRegionShare + cloudSoft,
          mx_noise_float(direction.mul(fewRegionScale)),
        );
        const show = smoothstep(
          scarceThreshold,
          scarceThreshold + cloudSoft,
          this.cloudOf(photo, clear),
        )
          .mul(mix(region, float(1), smoothstep(0.8, 1, cover)))
          .mul(near);
        result.assign(mix(blue, keep(photo, show), show));
        If(this.broken.greaterThan(scarceCover), () => {
          const mirrored = vec2(fract(float(sunU * 2).sub(u)), v);
          const second = min(texture(this.sky, mirrored).rgb, vec3(sunPeak));
          const extra = smoothstep(scarceCover, manyCover, this.broken)
            .mul(
              smoothstep(
                scarceThreshold,
                scarceThreshold + cloudSoft,
                this.cloudOf(second, texture(this.clearSky, mirrored).rgb),
              ),
            )
            .mul(near);
          result.assign(mix(result, keep(second, extra), extra));
        });
      });
      return result;
    })();
  }

  private cloudOf(
    photo: THREE.Node<"vec3">,
    clear: THREE.Node<"vec3">,
  ): THREE.Node<"float"> {
    const chroma = (c: THREE.Node<"vec3">) => c.z.sub(c.x).div(c.z.max(1e-4));
    return smoothstep(
      maskFrom,
      maskTo,
      float(1).sub(chroma(photo).div(chroma(clear).max(1e-3))),
    );
  }

  private cumulus(
    clear: THREE.Node<"vec3">,
    plane: THREE.Node<"vec2">,
    up: THREE.Node<"float">,
    towardSun: THREE.Node<"float">,
  ): THREE.Node<"vec3"> {
    const dome = plane.mul(up.max(0.06).div(up.add(cumulusCurve)));
    const shape = mx_fractal_noise_float(
      vec3(dome.mul(cumulusScale), this.cloudTime.mul(0.0015)),
      4,
    );
    const threshold = mix(float(0.32), float(-0.22), this.broken);
    const density = smoothstep(threshold, threshold.add(cumulusEdge), shape)
      .mul(smoothstep(0.0, 0.1, up))
      .mul(0.97);
    const core = smoothstep(threshold, threshold.add(0.55), shape);
    const [hr = 1, hg = 1, hb = 1] = this.meta.horizon;
    const horizon = vec3(hr, hg, hb).mul(skyGain);
    const [sr = 1, sg = 1, sb = 1] = this.meta.sunColor;
    const lit = horizon
      .mul(cumulusTop)
      .mul(mix(vec3(1), vec3(sr, sg, sb), 0.5));
    const shade = horizon.mul(cumulusBase).mul(vec3(0.92, 0.95, 1.0));
    const silver = towardSun.pow(6).mul(cumulusSilver).add(1);
    const cloud = mix(lit, shade, core).mul(silver);
    return mix(clear, cloud, density);
  }

  static async load(
    elevation: number,
    afternoon: boolean,
    night: number,
    compact: CompactSky | null = null,
    look: NightLook | null = null,
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
    return new SkyBox(
      sky,
      clearSky,
      environment,
      graded(meta, grade),
      skyExposures[name] ?? 1,
      night,
      grade,
      look,
    );
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
      sunShare * Math.PI * radiance * Math.min(1 / sine, sine / lowSunSine ** 2)
    );
  }

  get sunStrength(): number {
    return Math.min(1, Math.max(Math.sin(this.meta.elevation), 0) / lowSunSine);
  }

  get exposure(): number {
    const radiance = this.meta.skyRadiance[1] ?? 1;
    const day =
      Math.min(maxExposure, targetMidtone / ((1 + sunShare) * radiance)) *
      this.exposureScale;
    return day + (nightExposure - day) * this.nightShare;
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
