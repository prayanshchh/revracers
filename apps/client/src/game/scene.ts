import * as THREE from "three/webgpu";
import crewUrl from "../../../../content/tracks/hill-country/crew.glb?url";
import roadUrl from "../../../../content/tracks/hill-country/road.glb?url";
import { type Circuit, circuitFiles, type NightLook } from "./circuits.ts";
import { carFile, liteCarFiles, teams } from "./teams.ts";
import { buildTrainingGround } from "./training-ground.ts";
import {
  buildStreetCircuit,
  crewOf,
  garageCarsOf,
  polesOf,
  streetFiles,
} from "./street-ground.ts";
import { type CityData, cityGlow } from "./street-city.ts";
import type { StreetPole, StreetTrack } from "./street-layout.ts";
import { trainingTextures } from "./training-files.ts";
import type { LinePath, TrainingTrack } from "./training-layout.ts";
import { FieldCars } from "./field-cars.ts";
import { frameIndex, type Engine, type HudInfo } from "./engine.ts";
import type { WeatherInfo } from "./weather.ts";
import { farRain, nearRain, RainStreaks, Spray } from "./rain.ts";
import { type CarEnvironment, carWetness, rainLight } from "./carpaint.ts";
import {
  carState,
  type LookChange,
  partCount,
  partIndex,
  tyreState,
  updateLook,
} from "./car-damage.ts";
import { Debris, type Ground, type Walls } from "./debris.ts";
import { DamageLog } from "./damage-log.ts";
import { carField, carStride, carWheel } from "./frame-layout.ts";
import { GltfCar, placeOnTrack, type TrackFrame } from "./gltf.ts";
import { GridCars, type GridSlot } from "./grid.ts";
import {
  cascadeLayers,
  loadRoad,
  releaseCpuCopies,
  setCarContact,
  setStartLights,
  setWetness,
  type SkyRadiance,
  Sunlight,
} from "./road.ts";
import { Rumble, type RumbleWheel, type Shake } from "./rumble.ts";
import type { AtmosphereState } from "./atmosphere.ts";
import type { CameraPose } from "./buildup-shots.ts";
import type { RacingLineData, RacingLineMode } from "./racing-line.ts";
import { RacingLineView } from "./racing-line-view.ts";
import { paddockCrew } from "./paddock-crew.ts";
import { PitCrew } from "./pit-crew.ts";
import {
  expectDownloads,
  releaseUploadedImages,
  uploadEverything,
  uploadLater,
  warmLater,
} from "./preload.ts";
import { PitGate } from "./pit-gate.ts";
import type { PitControl, PitLayout } from "./pitstop.ts";
import { SkidMarks } from "./skidmarks.ts";
import { SafetyCar } from "./safety-car.ts";
import type { StartLights } from "./start-lights.ts";
import { SdSky } from "./sky.ts";
import { SkyBox } from "./skybox.ts";
import { sessionLight, type SessionLight } from "./daylight.ts";
import {
  floodMap,
  Floodlights,
  inWorld,
  layoutPoles,
  type TrackPoint,
} from "./floodlights.ts";
import { useFloodAmbient } from "./sky-ambient.ts";
import { Crowd, crowdAtlas, crowdData, standing } from "./crowd.ts";
import { treeDownloads, Trees } from "./scenery-trees.ts";
import { setCloudShadows } from "./scenery-look.ts";
import { TyreSmoke } from "./tyre-smoke.ts";
import { TyreStones } from "./tyre-stones.ts";
import {
  type CarMotion,
  GravelSpray,
  grassSurface,
  type WheelContact,
} from "./gravel-spray.ts";
import { tyreWetness } from "./tyre-paint.ts";
import { frustumContains, WorldCuller } from "./world-culler.ts";
import type { TyreInfo } from "./tyres.ts";

const gateLead = 30;
const onboardReach = 3;
const chaseFollow = 0.5;
const cameraListSlot = 21;
const carCameraList = -1;
const crewReach = 12;
const playerBayClear = 7;
const flipX = new THREE.Matrix4().makeScale(-1, 1, 1);
const sunGlow = 2.4;
const kelvinOffset = 273.15;
const cinematicNear = 0.5;
const cinematicFar = 41000;
const upAxis = new THREE.Vector3(0, 0, 1);
const clearVisibility = 5000;
const rainVisibility = 150;
const rainFogCurve = 1.5;
const overcastSun = 0.86;
const overcastExposure = 0.3;
const overcastAmbient = 0.4;
const rainDarkening = 0.65;
const overcastHaze = 0.96;
const chaseLens = 0.75;
const rainMist = 0.1;
const lensSpeed = 65;
const sprayLight = 0.75;
const streakLight = 0.6;
const forecastShare = 0.7;
const cloudsFromWater = 1.6;
const cloudSeconds = 25;
const rainLightHertz = 4;
const rainLightWater = 0.12;
const mirrorWater = 0.05;
const tyreWater = 0.12;
const bodyRain = 0.25;
const bodySeconds = 20;
const floodColour = new THREE.Color(1, 0.97, 0.92);
const floodIntensity = 2.4;
const floodElevation = (66 * Math.PI) / 180;
const floodAmbientUp = new THREE.Color(0.05, 0.05, 0.05);
const floodAmbientDown = new THREE.Color(0.1, 0.1, 0.095);
const nightGlare = 1.5;
const nightAir = 0.06;
const nightGlowMirror = 8;
const roadSheen = 2.5;
const cloudCover: Record<string, number> = {
  "no cloud": 0,
  "few clouds": 0.3,
  "scarce clouds": 0.45,
  "many clouds": 0.65,
  "full cover": 1,
};
const overcastFrom = 0.9;
const overcastDry = 0.85;
const brokenSun = 0.18;

const shockFrom = 0.3;
const shockFull = 1.2;
const shockHold = 2.2;
const shockFade = 1.6;

function coverOf(clouds: string): number {
  const known = cloudCover[clouds];
  if (known !== undefined) return known;
  const all = Object.values(cloudCover);
  return all[Math.floor(Math.random() * all.length)] ?? 0;
}

interface TrackData {
  length: number;
  grid: GridSlot[];
  centerline: TrackPoint[];
  pitLane: { entry: number; exit: number } | null;
}

function buildFloodlights(
  data: TrackData,
  frame: TrackFrame,
  start: [number, number, number],
): Floodlights {
  const poles = layoutPoles(
    data.centerline,
    data.pitLane ?? { entry: 0, exit: 0 },
  );
  const holder = new THREE.Group();
  const placed = placeOnTrack(holder, frame, start);
  const toWorld = placed.matrix;
  const track = data.centerline.map((p) =>
    new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(toWorld),
  );
  const lights = new Floodlights(
    poles,
    floodMap(track, inWorld(poles, toWorld)),
  );
  holder.add(lights.root);
  lights.placed = placed;
  return lights;
}

function buildStreetLights(
  data: TrackData,
  poles: StreetPole[],
  frame: TrackFrame,
  start: [number, number, number],
): Floodlights {
  const holder = new THREE.Group();
  const placed = placeOnTrack(holder, frame, start);
  const toWorld = placed.matrix;
  const vector = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2]);
  const lamps = poles.map((pole) => {
    const head = vector(pole.head);
    const aim = vector(pole.aim);
    return {
      base: vector(pole.base),
      head,
      aim,
      power: head.distanceToSquared(aim),
    };
  });
  const track = data.centerline.map((p) =>
    new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(toWorld),
  );
  return new Floodlights([], floodMap(track, inWorld(lamps, toWorld)));
}

const dryWeather: WeatherInfo = {
  rain: 0,
  lineWater: 0,
  offWater: 0,
  carWater: 0,
  clock: 0,
  slickLimit: 0,
  interLimit: 0,
  forecast: [],
};

interface SessionLighting {
  colour: THREE.Color;
  intensity: number;
  elevation: number;
  haze: THREE.Color;
  sunGlow: number;
  glare: number;
  glowMirror: number;
  sheen: number;
  air: THREE.Color | null;
  cloudLight: number;
}

function nightLighting(
  skyBox: SkyBox,
  look: NightLook | null,
): SessionLighting {
  return {
    colour: look ? new THREE.Color(...look.tint) : floodColour.clone(),
    intensity: look ? look.flood : floodIntensity,
    elevation: floodElevation,
    haze: look ? new THREE.Color(...look.haze) : skyBox.nightHaze,
    sunGlow: 0,
    glare: nightGlare,
    glowMirror: nightGlowMirror,
    sheen: 0,
    air: floodColour.clone().multiplyScalar(nightAir),
    cloudLight: 0,
  };
}

function sessionLighting(
  skyBox: SkyBox,
  night: boolean,
  look: NightLook | null,
): SessionLighting {
  if (night) return nightLighting(skyBox, look);
  const [sr = 1, sg = 1, sb = 1] = skyBox.meta.sunColor;
  const [hr = 1, hg = 1, hb = 1] = skyBox.meta.horizon;
  return {
    colour: new THREE.Color(sr, sg, sb),
    intensity: skyBox.sunIntensity,
    elevation: skyBox.meta.elevation,
    haze: new THREE.Color(hr, hg, hb),
    sunGlow: sunGlow * skyBox.sunStrength,
    glare: 1,
    glowMirror: 0,
    sheen: roadSheen,
    air: null,
    cloudLight: 1,
  };
}

function eased(current: number, target: number, step: number): number {
  return current < 0 ? target : current + (target - current) * step;
}

function rainLightLevel(weather: WeatherInfo, time: number): number {
  if (weather.rain <= 0.05 && weather.lineWater <= rainLightWater) return 0;
  return Math.sin(time * Math.PI * 2 * rainLightHertz) > 0 ? 1 : 0.12;
}

function presentRoots(
  ...items: ({ root: THREE.Object3D } | null)[]
): THREE.Object3D[] {
  return items.flatMap((item) => (item ? [item.root] : []));
}

function venueDownloads(
  circuit: Circuit,
  team: string,
  rivals: string[],
): string[] {
  const fleet =
    rivals.length > 0 ? [team, ...rivals] : teams.map((each) => each.id);
  const ground =
    circuit.ground === "street"
      ? [...trainingTextures, ...streetFiles, ...crowdAtlas, crewUrl]
      : [roadUrl, crewUrl, crowdData];
  return [
    ...ground,
    ...(circuit.trees ? [circuit.trees, ...treeDownloads()] : []),
    ...circuitFiles(circuit),
    carFile(team, "car.glb"),
    ...[...new Set(fleet)].map((each) => carFile(each, "lod.glb")),
  ];
}

function lightFiles(circuit: Circuit, team: string): string[] {
  return [...circuitFiles(circuit), ...trainingTextures, ...liteCarFiles(team)];
}

export async function fetchJson<T>(url: string): Promise<T> {
  THREE.DefaultLoadingManager.itemStart(url);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`failed to load ${url}`);
    return (await response.json()) as T;
  } finally {
    THREE.DefaultLoadingManager.itemEnd(url);
  }
}

interface SharedLoads {
  sky: Promise<SkyBox>;
  env: Promise<CarEnvironment>;
  radiance: Promise<SkyRadiance>;
  track: Promise<TrackData>;
  line: Promise<RacingLineData>;
  city: Promise<CityData> | null;
}

function sharedLoads(
  renderer: THREE.WebGPURenderer,
  light: SessionLight,
  circuit: Circuit,
): SharedLoads {
  const sky = SkyBox.load(
    light.elevation,
    light.afternoon,
    light.night,
    circuit.sky,
    circuit.night,
  ).then((loaded) => {
    loaded.refreshEnvironment(renderer, 0, 1);
    return loaded;
  });
  return {
    sky,
    env: sky.then((loaded) => ({
      texture: loaded.environment,
      rotation: loaded.environmentRotation,
    })),
    radiance: sky.then(
      (loaded): SkyRadiance =>
        (direction) =>
          loaded.radiance(direction, false),
    ),
    track: fetchJson<TrackData>(circuit.track),
    line: fetchJson<RacingLineData>(circuit.racingLine),
    city:
      circuit.ground === "street" && circuit.city
        ? fetchJson<CityData>(circuit.city)
        : null,
  };
}

function groundOf(
  circuit: Circuit,
  renderer: THREE.WebGPURenderer,
  loads: SharedLoads,
  after: Promise<unknown>,
): Promise<THREE.Object3D> {
  const anisotropy = renderer.getMaxAnisotropy();
  if (loads.city) {
    return Promise.all([loads.track, loads.line, loads.city]).then(
      ([data, line, cityData]) =>
        buildStreetCircuit(
          data as unknown as StreetTrack,
          line as LinePath,
          cityData,
          anisotropy,
          loads.radiance,
          after,
        ),
    );
  }
  if (circuit.ground === "glb") {
    const limit =
      (renderer.backend as { device?: GPUDevice }).device?.limits
        .maxTextureDimension2D ?? defaultTextureLimit;
    return loadRoad(roadUrl, anisotropy, limit, loads.radiance);
  }
  return Promise.all([loads.track, loads.line]).then(([data, line]) =>
    buildTrainingGround(
      data as unknown as TrainingTrack,
      line as LinePath,
      anisotropy,
      loads.radiance,
      after,
    ),
  );
}

async function venueExtras(
  circuit: Circuit,
  anisotropy: number,
  team: string,
  loads: SharedLoads,
): Promise<{ people: Crowd | null; crew: PitCrew | null }> {
  if (!circuit.venue) return { people: null, crew: null };
  const [people, crew] = await Promise.all([
    loads.city
      ? loads.city.then((city) => Crowd.load(standing(city.spectators)))
      : circuit.ground === "glb"
        ? Crowd.load()
        : null,
    loads.env.then((loaded) => PitCrew.load(crewUrl, anisotropy, loaded, team)),
  ]);
  return { people, crew };
}

async function parkedGrid(
  engine: Engine,
  team: string,
  loads: SharedLoads,
): Promise<GridCars> {
  const [gridData, env] = await Promise.all([loads.track, loads.env]);
  const lengthScale = engine.trackLength() / gridData.length;
  return GridCars.load(
    team,
    gridData.grid.map((slot) => ({
      distance: slot.distance * lengthScale,
      offset: slot.offset,
    })),
    engine.trackPoint.bind(engine),
    env,
  );
}

interface PitFrame extends TrackFrame {
  pit?: { shift: number; boxDistance: number } | null;
}

async function garagedCars(
  engine: Engine,
  road: Promise<THREE.Object3D>,
  frame: Promise<PitFrame>,
  loads: SharedLoads,
): Promise<GridCars> {
  const [ground, sd, data, env] = await Promise.all([
    road,
    frame,
    loads.track,
    loads.env,
  ]);
  const length = engine.trackLength();
  const scale = length / data.length;
  const shift = sd.pit?.shift ?? 0;
  const box = sd.pit?.boxDistance ?? -length;
  const gap = (distance: number) => {
    const ahead = (((distance - box) % length) + length) % length;
    return Math.min(ahead, length - ahead);
  };
  const slots = garageCarsOf(ground)
    .map((car) => ({
      distance: car.s * scale,
      offset: car.lateral - shift,
      team: car.team,
    }))
    .filter((slot) => gap(slot.distance) > playerBayClear);
  return GridCars.garages(slots, engine.trackPoint.bind(engine), env);
}

const defaultTextureLimit = 8192;
const aiWheelRadius = 0.36;
const gravelFields = 2;
const gravelStride = 4 * gravelFields;

function offTrack(gravel: Float64Array, car: number): boolean {
  for (let i = 0; i < 4; i++)
    if ((gravel[(car * 4 + i) * gravelFields] ?? 0) >= grassSurface)
      return true;
  return false;
}

export class Scene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(67.5, 1, 1, 41000);
  private readonly view = new THREE.Matrix4();
  private readonly rumble = new Rumble();
  private readonly shakeMatrix = new THREE.Matrix4();
  private readonly carPose = new THREE.Matrix4();
  private readonly shakeTurn = new THREE.Matrix4();
  private readonly shakeEye = new THREE.Vector3();
  private readonly cinematicLook = new THREE.Matrix4();
  private shake: Shake | null = null;
  private lastFeel = 0;
  private readonly eye = new THREE.Vector3();
  private readonly sunShine = new THREE.Color();
  private readonly carPosition = new THREE.Vector3();
  private viewMirrored = false;
  private cinematic: CameraPose | null = null;
  private readonly sunlight: Sunlight;
  private readonly smoke = new TyreSmoke();
  private readonly rain = new RainStreaks(nearRain);
  private readonly farRain = new RainStreaks(farRain);
  private readonly spray = new Spray();
  private readonly debris = new Debris();
  private readonly damageLog = new DamageLog();
  private readonly noDamage = new Float32Array(carState);
  private readonly noParts = new Float32Array(partCount);
  private readonly playerParts = new Float64Array(partCount);
  private damageState = new Float64Array(0);
  private shockPeak = 0;
  private shockAt = -Infinity;
  private pastShown = false;
  private readonly gravel = new GravelSpray();
  private readonly tyreStones: TyreStones;
  private readonly gravelMatrix = new THREE.Matrix4();
  private readonly gravelPoint = new THREE.Vector3();
  private readonly gravelForward = new THREE.Vector3();
  private readonly damageMatrix = new THREE.Matrix4();
  private readonly damageVelocity = new THREE.Vector3();
  private weather = dryWeather;
  private overcast = -1;
  private bodyWater = -1;
  private weatherTime = 0;
  private cars: Float64Array | null = null;
  private readonly baseHaze = new THREE.Color();
  private readonly greyHaze = new THREE.Color();
  private readonly streakColour = new THREE.Color();
  private readonly sprayColour = new THREE.Color();
  private baseExposure = 1;
  private readonly cloudLight: number;
  private readonly airLight: THREE.Color | null;
  private readonly clearSight: number;
  private readonly moving: THREE.Object3D[];
  private readonly safetyCar = new SafetyCar();
  private signalAt = 0;
  private readonly viewFrustum = new THREE.Frustum();
  private mirrorViews: THREE.Frustum[] = [];
  private insetView: THREE.Frustum | null = null;
  private liveFrame: Float64Array | null = null;
  private liveDraw: [boolean, boolean, boolean] | null = null;
  private liveShown: boolean[] = [];
  private readonly seen = {
    intersectsSphere: (sphere: THREE.Sphere): boolean =>
      this.viewFrustum.intersectsSphere(sphere) ||
      this.mirrorViews.some((view) => view.intersectsSphere(sphere)) ||
      (this.insetView?.intersectsSphere(sphere) ?? false),
    containsSphere: (sphere: THREE.Sphere): boolean =>
      frustumContains(this.viewFrustum, sphere),
  };
  private readonly viewMatrix = new THREE.Matrix4();
  private warming = false;
  private debrisCars = false;
  private crewOut = false;
  private compound = 1;
  private fittedCompound = 1;
  private fittedWear = 0;
  private wear = 0;
  private readonly crewBounds = new THREE.Sphere(
    new THREE.Vector3(),
    crewReach,
  );
  readonly marks = new SkidMarks();
  readonly gate = new PitGate();
  readonly atmosphere: AtmosphereState = {
    sunDirection: new THREE.Vector3(),
    haze: new THREE.Color(),
    sun: new THREE.Color(),
    exposure: 1,
    visibility: clearVisibility,
    lensWater: 0,
    reflections: 0,
    mist: 0,
    airflow: 0,
    time: 0,
    detail: false,
    glare: 1,
    glowMirror: 0,
    sheen: 0,
    shock: 0,
    layer: 0,
    layerBase: 0,
  };

  private constructor(
    private readonly sky: SdSky,
    private readonly skyBox: SkyBox,
    private readonly people: Crowd | null,
    private readonly trees: Trees | null,
    private readonly car: GltfCar,
    private readonly grid: GridCars | null,
    track: THREE.Object3D,
    private readonly road: THREE.Object3D,
    private readonly culler: WorldCuller,
    private readonly racingLine: RacingLineView,
    readonly crew: PitCrew | null,
    private readonly lapScale: number,
    private readonly field: FieldCars | null,
    private lights: StartLights,
    light: SessionLight,
    floodlights: Floodlights | null,
    private readonly cover: number,
    look: NightLook | null,
  ) {
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    this.scene.environment = skyBox.environment;
    const extras = presentRoots(grid, field);
    this.scene.add(
      skyBox.mesh,
      track,
      car.root,
      warmLater(this.smoke.root),
      warmLater(this.rain.mesh),
      warmLater(this.farRain.mesh),
      warmLater(this.spray.root),
      warmLater(this.debris.root),
      warmLater(this.gravel.root),
      ...extras,
    );
    this.tyreStones = new TyreStones(car.tyreMounts());
    this.tyreStones.meshes.forEach(warmLater);
    const night = light.night >= 1;
    const lit = sessionLighting(skyBox, night, look);
    this.clearSight = night && look ? look.visibility : clearVisibility;
    this.atmosphere.layer = night && look ? look.layer : 0;
    this.cloudLight = lit.cloudLight;
    this.airLight = lit.air;
    this.sunlight = new Sunlight(
      this.scene,
      lit.intensity,
      lit.colour,
      lit.elevation,
    );
    this.placeFloodlights(floodlights, track, light.lamps, night);
    this.atmosphere.sun.copy(lit.colour).multiplyScalar(lit.sunGlow);
    this.atmosphere.glare = lit.glare;
    this.atmosphere.glowMirror = lit.glowMirror;
    this.atmosphere.sheen = lit.sheen;
    this.atmosphere.haze.copy(lit.haze);
    this.atmosphere.exposure = skyBox.exposure;
    this.baseExposure = skyBox.exposure;
    this.baseHaze.copy(this.atmosphere.haze);
    this.greyHaze.copy(skyBox.overcastHorizon).multiplyScalar(overcastHaze);
    this.scene.add(
      this.marks.mesh,
      ...presentRoots(this.crew),
      warmLater(this.gate.mesh),
      warmLater(this.safetyCar.root),
    );
    this.moving = [
      skyBox.mesh,
      car.root,
      this.gate.mesh,
      this.safetyCar.root,
      ...extras,
    ];
    culler.narrowViews();
    car.focusMirror = (view) => {
      culler.focus(view);
    };
    this.scene.updateMatrixWorld(true);
    this.scene.matrixWorldAutoUpdate = false;
    culler.bake();
  }

  private placeFloodlights(
    floodlights: Floodlights | null,
    track: THREE.Object3D,
    lamps: number,
    night: boolean,
  ): void {
    if (!floodlights) return;
    floodlights.glow.value = lamps;
    if (floodlights.placed) track.add(floodlights.placed);
    if (!night) return;
    this.sunlight.floodlit(floodlights.cover);
    useFloodAmbient(floodlights.cover, floodAmbientUp, floodAmbientDown);
  }

  static async load(
    engine: Engine,
    team: string,
    renderer: THREE.WebGPURenderer,
    lineMode: RacingLineMode,
    rivals: string[],
    lights: StartLights,
    clouds: string,
    circuit: Circuit,
  ): Promise<Scene> {
    const venue = circuit.venue;
    expectDownloads(Scene.downloads(circuit, team, rivals));
    const anisotropy = renderer.getMaxAnisotropy();
    const local = engine.trackLocal();
    const light = sessionLight(local.timeOfDay / 3600);
    const loads = sharedLoads(renderer, light, circuit);
    const carLoad = loads.env.then((env) =>
      GltfCar.load(team, renderer, env, !venue),
    );
    const frameLoad = fetchJson<PitFrame>(circuit.frame);
    const roadLoad = groundOf(circuit, renderer, loads, carLoad);
    const [
      skyBox,
      frame,
      { people, crew },
      trees,
      road,
      data,
      car,
      gridData,
      grid,
      field,
    ] = await Promise.all([
      loads.sky,
      frameLoad,
      venueExtras(circuit, anisotropy, team, loads),
      circuit.trees ? Trees.load(circuit.trees, anisotropy) : null,
      roadLoad,
      loads.line,
      carLoad,
      loads.track,
      venue && rivals.length === 0
        ? circuit.ground === "street"
          ? garagedCars(engine, roadLoad, frameLoad, loads)
          : parkedGrid(engine, team, loads)
        : null,
      rivals.length > 0
        ? loads.env.then((env) => FieldCars.load(rivals, env))
        : null,
    ]);
    const racingLine = new RacingLineView(data, data.profile, lineMode);
    const start = engine.trackPoint(0, 0);
    const placed = placeOnTrack(road, frame, start);
    placed.updateMatrixWorld(true);
    const culler = new WorldCuller(road, cascadeLayers);
    cityGlow.value = light.lamps;
    const floodlights =
      venue && light.lamps > 0
        ? circuit.ground === "street"
          ? buildStreetLights(gridData, polesOf(road), frame, start)
          : buildFloodlights(gridData, frame, start)
        : null;
    const track = new THREE.Group();
    track.add(
      placed,
      ...presentRoots(people, trees).map((root) =>
        placeOnTrack(root, frame, start),
      ),
      placeOnTrack(racingLine.root, frame, start),
    );
    const scene = new Scene(
      new SdSky(local),
      skyBox,
      people,
      trees,
      car,
      grid,
      track,
      road,
      culler,
      racingLine,
      crew,
      data.length / engine.trackLength(),
      field,
      lights,
      light,
      floodlights,
      coverOf(clouds),
      circuit.night,
    );
    scene.atmosphere.layerBase = start[2];
    scene.useGround(
      (x, y) => engine.groundHeight(x, y),
      (x, y) => engine.barriers(x, y),
    );
    engine.barriers(0, 0);
    return scene;
  }

  warmMirrors(renderer: THREE.WebGPURenderer): void {
    this.car.warmMirrors(renderer, this.scene);
  }

  compileMirrors(renderer: THREE.WebGPURenderer): Promise<void> {
    return this.car.compileMirrors(renderer, this.scene);
  }

  static downloads(circuit: Circuit, team: string, rivals: string[]): string[] {
    return circuit.venue
      ? venueDownloads(circuit, team, rivals)
      : lightFiles(circuit, team);
  }

  finishCar(): Promise<void> {
    return this.car.finish();
  }

  updateField(cars: Float64Array): void {
    this.cars = cars;
    this.field?.update(cars, this.camera);
  }

  updateSafetyCar(
    pose: ArrayLike<number> | null,
    lightsOn: boolean,
    now: number,
  ): void {
    this.safetyCar.update(pose, lightsOn, now);
  }

  restartLights(lights: StartLights, signalAt: number): void {
    this.lights = lights;
    this.signalAt = signalAt;
  }

  get fieldCars(): Float64Array | null {
    return this.cars;
  }

  setDamage(
    damage: Float64Array,
    tyres: Float64Array,
    frame: Float64Array,
  ): void {
    const count = Math.floor(damage.length / partCount);
    const time = frame[frameIndex.time] ?? 0;
    if (this.pastShown) {
      this.pastShown = false;
      this.showLogged(time);
    }
    if (this.damageState.length !== count * carState)
      this.damageState = new Float64Array(count * carState);
    const state = this.damageState;
    for (let i = 0; i < count; i++) {
      state.set(
        damage.subarray(i * partCount, (i + 1) * partCount),
        i * carState,
      );
      state.set(
        tyres.subarray(i * 4 * tyreState, (i + 1) * 4 * tyreState),
        i * carState + partCount,
      );
    }
    this.damageLog.record(time, state, carState);
    this.feelHit(time, state);
    for (let i = 0; i < count; i++) {
      const changes = this.applyCar(
        i,
        state.subarray(i * carState, (i + 1) * carState),
      );
      if (changes.length === 0 || !this.placeDamaged(i, frame)) continue;
      for (const change of changes)
        this.debris.spawn(
          time,
          i,
          this.damageMatrix,
          this.damageVelocity,
          change,
        );
    }
  }

  private addDebrisCars(): void {
    if (this.debrisCars) return;
    this.debrisCars = true;
    const { field } = this;
    this.debris.addCar(0, this.car.debrisPieces());
    this.debris.addWheels(0, this.car.wheelPieces);
    for (let i = 1; ; i++) {
      const pieces = field?.piecesOf(i);
      if (!pieces) return;
      this.debris.addCar(i, pieces);
      this.debris.addWheels(i, field?.wheelPiecesOf(i) ?? []);
    }
  }

  private feelHit(time: number, state: Float64Array): void {
    let hit = 0;
    for (let k = 0; k < partCount; k++) {
      const now = state[k] ?? 0;
      hit += Math.max(0, now - (this.playerParts[k] ?? 0));
      this.playerParts[k] = now;
    }
    if (hit < shockFrom) return;
    const level = Math.min(
      1,
      (hit - shockFrom) / (shockFull - shockFrom) + 0.5,
    );
    this.shockPeak = Math.max(this.shockLevel(time), level);
    this.shockAt = time;
  }

  private shockLevel(time: number): number {
    if (this.cinematic) return 0;
    const age = time - this.shockAt;
    if (age < 0 || age > shockHold + shockFade) return 0;
    const fade = Math.min(1, Math.max(0, (age - shockHold) / shockFade));
    return this.shockPeak * (1 - fade * fade * (3 - 2 * fade));
  }

  get shock(): number {
    return this.atmosphere.shock;
  }

  private applyCar(index: number, state: ArrayLike<number>): LookChange[] {
    const look = index === 0 ? this.car.damage : this.field?.damageOf(index);
    if (!look) return [];
    const changes = updateLook(look, state, 0);
    const bends = Array.from(
      { length: 4 },
      (_, k) => state[partIndex.suspension + k] ?? 0,
    );
    if (index === 0) this.car.setSuspension(bends);
    else this.field?.setDamageState(index, state);
    return changes;
  }

  useGround(ground: Ground, walls: Walls): void {
    this.debris.setGround(ground);
    this.debris.setWalls(walls);
  }

  private placeDamaged(index: number, frame: Float64Array): boolean {
    const source = index === 0 ? frame : this.cars;
    if (!source) return false;
    const at = index === 0 ? frameIndex.posMat : index * carStride;
    const speed =
      index === 0
        ? (frame[frameIndex.speed] ?? 0)
        : (source[at + carField.speed] ?? 0);
    this.damageMatrix.fromArray(source, at);
    this.damageVelocity
      .setFromMatrixColumn(this.damageMatrix, 0)
      .multiplyScalar(speed);
    return true;
  }

  cutDebris(time: number): void {
    this.debris.cut(time);
    this.gravel.clear();
    this.tyreStones.clear();
    this.damageLog.cut(time);
    this.shockPeak = 0;
    this.playerParts.set(
      this.damageLog.partsAt(0, time)?.subarray(0, partCount) ?? this.noParts,
    );
  }

  private showPast(time: number): void {
    this.pastShown = true;
    this.showLogged(time);
    const wheels = this.damageLog.tyresAt(time);
    if (wheels) this.car.setTyreCondition(wheels);
  }

  private showLogged(time: number): void {
    for (let i = 0; i < this.damageLog.carCount; i++)
      this.applyCar(i, this.damageLog.partsAt(i, time) ?? this.noDamage);
  }

  updateGravel(
    frame: Float64Array,
    wheels: readonly { spin: number; radius: number }[],
    gravel: Float64Array,
  ): void {
    const player = this.gravelSource(
      frame,
      frameIndex.posMat,
      frame[frameIndex.speed] ?? 0,
      (i) => [
        frame[frameIndex.wheels + i * 7] ?? 0,
        frame[frameIndex.wheels + i * 7 + 1] ?? 0,
        frame[frameIndex.wheels + i * 7 + 2] ?? 0,
      ],
      gravel,
      0,
      (i) => wheels[i]?.radius ?? aiWheelRadius,
      (i, speed) =>
        Math.abs(wheels[i]?.spin ?? 0) * (wheels[i]?.radius ?? 0) -
        Math.abs(speed),
    );
    const sources = [player];
    const cars = this.cars;
    const count = gravel.length / gravelStride;
    if (cars)
      for (let k = 1; k < count; k++) {
        if (!offTrack(gravel, k)) continue;
        const at = k * carStride;
        sources.push(
          this.gravelSource(
            cars,
            at,
            cars[at + carField.speed] ?? 0,
            (i) => [
              cars[at + carWheel.from + i * carWheel.stride] ?? 0,
              cars[at + carWheel.from + i * carWheel.stride + 1] ?? 0,
              cars[at + carWheel.from + i * carWheel.stride + 2] ?? 0,
            ],
            gravel,
            k,
            () => aiWheelRadius,
            () => 0,
          ),
        );
      }
    this.gravel.update(frame[frameIndex.time] ?? 0, sources);
    const stones = [0, 1, 2, 3].map((i) => gravel[i * gravelFields + 1] ?? 0);
    this.tyreStones.update(
      stones,
      [0, 1, 2, 3].map((i) => frame[frameIndex.wheels + i * 7 + 6] ?? 0),
      player.motion,
      this.gravel,
    );
  }

  private gravelSource(
    source: Float64Array,
    at: number,
    speed: number,
    wheelAt: (i: number) => [number, number, number],
    gravel: Float64Array,
    car: number,
    radius: (i: number) => number,
    slip: (i: number, speed: number) => number,
  ): { key: string; motion: CarMotion; wheels: WheelContact[] } {
    this.gravelMatrix.fromArray(source, at);
    this.gravelForward.setFromMatrixColumn(this.gravelMatrix, 0).normalize();
    const motion = {
      vx: this.gravelForward.x * speed,
      vy: this.gravelForward.y * speed,
      vz: 0,
      fx: this.gravelForward.x,
      fy: this.gravelForward.y,
    };
    const wheels = [0, 1, 2, 3].map((i): WheelContact => {
      const [x, y, z] = wheelAt(i);
      this.gravelPoint.set(x, y, z - radius(i)).applyMatrix4(this.gravelMatrix);
      return {
        x: this.gravelPoint.x,
        y: this.gravelPoint.y,
        z: this.gravelPoint.z,
        surface: gravel[(car * 4 + i) * gravelFields] ?? 0,
        slip: slip(i, speed),
      };
    });
    return { key: String(car), motion, wheels };
  }

  setWeather(weather: WeatherInfo): void {
    this.weather = weather;
  }

  private applyWeather(frame: Float64Array, onboard: boolean): void {
    const w = this.weather;
    const time = frame[frameIndex.time] ?? 0;
    const rain = w.rain;
    const coming = Math.max(rain, (w.forecast[0] ?? 0) * forecastShare);
    const overcastFloor = this.cover >= overcastFrom ? overcastDry : 0;
    const target = Math.min(
      1,
      Math.max(coming * 4, w.offWater * cloudsFromWater, overcastFloor),
    );
    const dt = Math.max(0, Math.min(1, time - this.weatherTime));
    this.weatherTime = time;
    this.overcast = eased(
      this.overcast,
      target,
      Math.min(1, dt / cloudSeconds),
    );
    const overcast = this.overcast;
    this.skyBox.overcast.value = overcast;
    this.skyBox.overcastLight.value = 1 - rainDarkening * rain * rain;
    this.skyBox.cloudTime.value = time;
    const broken = this.cover < overcastFrom ? this.cover : 0;
    this.skyBox.broken.value = broken;
    const shaded = overcast * this.cloudLight;
    this.sunlight.dim(
      (1 - overcastSun * shaded) * (1 - brokenSun * broken * this.cloudLight),
    );
    setCloudShadows(broken * this.cloudLight * (1 - overcast), time);
    this.scene.environmentIntensity = 1 - overcastAmbient * shaded;
    this.atmosphere.exposure =
      this.baseExposure * (1 + overcastExposure * shaded);
    this.atmosphere.haze
      .copy(this.baseHaze)
      .lerp(this.greyHaze, overcast)
      .multiplyScalar(this.skyBox.overcastLight.value);
    this.atmosphere.visibility =
      1 /
      (1 / this.clearSight +
        (1 / rainVisibility - 1 / this.clearSight) *
          Math.pow(rain, rainFogCurve));
    const speed = Math.abs(frame[frameIndex.speed] ?? 0);
    this.atmosphere.lensWater = rain * (onboard ? 1 : chaseLens);
    this.atmosphere.mist = rainMist * Math.sqrt(rain);
    this.atmosphere.airflow = Math.min(1, speed / lensSpeed);
    this.atmosphere.time = time;
    setWetness(w.lineWater, w.offWater);
    tyreWetness.value = Math.min(1, Math.max(w.carWater, rain) / tyreWater);
    const soaked = Math.min(1, rain / bodyRain);
    this.bodyWater = eased(
      this.bodyWater,
      soaked,
      Math.min(1, dt / bodySeconds),
    );
    carWetness.value = this.bodyWater;
    this.atmosphere.reflections = Math.min(
      1,
      Math.max(w.lineWater, w.offWater) / mirrorWater,
    );
    rainLight.value = rainLightLevel(w, time);
    const air = this.airLight ?? this.atmosphere.haze;
    this.streakColour.copy(air).multiplyScalar(streakLight);
    this.sprayColour.copy(air).multiplyScalar(sprayLight);
    this.rain.update(rain, this.eye, time, this.streakColour);
    this.farRain.update(rain, this.eye, time, this.streakColour);
    this.spray.update(
      time,
      { rain, water: (w.lineWater + w.offWater) / 2 },
      frame,
      this.cars,
      this.eye,
      this.sprayColour,
    );
  }

  feel(
    wheels: RumbleWheel[],
    speed: number,
    now: number,
    tyreRough: number,
  ): number {
    this.shake = this.rumble.update(
      wheels,
      speed,
      now - this.lastFeel,
      now,
      tyreRough,
    );
    this.lastFeel = now;
    this.car.setRumble(this.shake.heave, this.shake.pitch, this.shake.roll);
    return this.shake.amount;
  }

  updatePit(control: PitControl, frame: Float64Array, fresh: number): void {
    this.crewOut = control.phase !== "track";
    const active = control.phase === "service";
    if (!active) {
      this.fittedCompound = this.compound;
      this.fittedWear = this.wear;
    }
    this.gate.update(control.countdown);
    if (!this.crew) return;
    this.crew.setCompounds(this.fittedCompound, fresh, this.fittedWear);
    const eye = new THREE.Vector3().setFromMatrixPosition(
      this.camera.matrixWorld,
    );
    const carMatrix = new THREE.Matrix4().fromArray(frame, frameIndex.posMat);
    const { lift, wheelsOff } = this.crew.update(
      control.serviceProgress,
      active,
      active ? carMatrix : null,
      eye,
      performance.now() / 1000,
    );
    this.car.setPitService(lift, wheelsOff);
  }

  placePit(
    layout: PitLayout,
    point: (distance: number, lateral: number) => [number, number, number],
  ): void {
    const lateral = layout.boxLateral - layout.shift;
    const [x, y, z] = point(layout.boxDistance, lateral);
    const [x2, y2] = point(layout.boxDistance + 2, lateral);
    this.crew?.setAnchor(x, y, z, Math.atan2(y2 - y, x2 - x));
    const turn = layout.boxDistance - gateLead;
    const gateLateral = layout.fastLane - layout.shift;
    const [gx, gy, gz] = point(turn, gateLateral);
    const [hx, hy] = point(turn + 2, gateLateral);
    this.gate.place(gx, gy, gz, Math.atan2(hy - gy, hx - gx));
  }

  async populatePaddock(box: number, anisotropy: number): Promise<void> {
    const { spots, length } = crewOf(this.road);
    const near = box * this.lapScale;
    const kept = spots.filter((spot) => {
      const gap = (((spot.s - near) % length) + length) % length;
      return !spot.garage || Math.min(gap, length - gap) > playerBayClear;
    });
    if (kept.length === 0) return;
    const group = await paddockCrew(crewUrl, kept, anisotropy);
    this.road.add(group);
    group.updateMatrixWorld(true);
  }

  renderAuxiliary(renderer: THREE.WebGPURenderer): void {
    this.skyBox.refreshEnvironment(
      renderer,
      Math.max(0, this.overcast),
      this.skyBox.overcastLight.value,
    );
    this.sunlight.freeze();
    if (this.warming && this.crew) this.crew.root.visible = true;
    this.car.renderAuxiliary(renderer, this.scene);
  }

  setDash(info: HudInfo): void {
    this.car.setDash({
      fuel: info.tank > 0 ? info.fuel / info.tank : 0,
      tyres: info.tyreTemp.map((kelvin) => kelvin - kelvinOffset),
    });
  }

  get playerSlot(): number {
    return this.grid?.playerSlot ?? 0;
  }

  get mirrored(): boolean {
    return this.viewMirrored;
  }

  private updateContact(frame: Float64Array): void {
    const pose = frameIndex.posMat;
    setCarContact(
      frame[pose + 12] ?? 0,
      frame[pose + 13] ?? 0,
      frame[pose] ?? 1,
      frame[pose + 1] ?? 0,
    );
  }

  setCinematic(pose: CameraPose | null): void {
    this.cinematic = pose;
    this.racingLine.root.visible = pose === null;
  }

  private applyCinematic(pose: CameraPose): void {
    const eye = new THREE.Vector3(...pose.eye);
    this.cinematicLook.lookAt(eye, new THREE.Vector3(...pose.target), upAxis);
    this.cinematicLook.setPosition(eye);
    this.camera.matrixWorld.copy(this.cinematicLook);
    this.camera.matrixWorldInverse.copy(this.cinematicLook).invert();
    this.viewMirrored = false;
    this.setLens(pose.fov, cinematicNear, cinematicFar);
  }

  private setLens(fov: number, near: number, far: number): void {
    if (
      this.camera.fov === fov &&
      this.camera.near === near &&
      this.camera.far === far
    )
      return;
    this.camera.fov = fov;
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
    this.sunlight.refit();
  }

  private applyDriverView(frame: Float64Array): void {
    const c = frameIndex.camera;
    const at = (k: number) => frame[c + k] ?? 0;
    this.view.fromArray(frame, c);
    this.applyShake(frame);
    const det = this.view.determinant();
    if (Math.abs(det) > 1e-6) {
      this.viewMirrored = det < 0;
      if (this.viewMirrored) this.view.premultiply(flipX);
      this.camera.matrixWorld.copy(this.view).invert();
      this.camera.matrixWorldInverse.copy(this.view);
    }
    this.setLens(at(16), at(17), at(18));
  }

  private applyShake(frame: Float64Array): void {
    if (!this.shake) return;
    this.carPose.fromArray(frame, frameIndex.posMat);
    this.shakeEye.setFromMatrixPosition(
      this.shakeMatrix.copy(this.view).invert(),
    );
    const onboard =
      this.shakeEye.distanceToSquared(
        this.carPosition.setFromMatrixPosition(this.carPose),
      ) <
      onboardReach * onboardReach;
    const carCamera =
      frame[frameIndex.camera + cameraListSlot] === carCameraList;
    if (!onboard && !carCamera) return;
    this.car.bodyBounce(onboard ? 1 : chaseFollow, this.shakeMatrix).invert();
    this.view
      .multiply(this.carPose)
      .multiply(this.shakeMatrix)
      .multiply(this.carPose.invert());
    this.view.premultiply(
      this.shakeMatrix
        .makeRotationX(this.shake.buzzPitch)
        .multiply(this.shakeTurn.makeRotationY(this.shake.buzzYaw)),
    );
  }

  showInset(view: THREE.Frustum | null): void {
    this.insetView = view;
  }

  posePast(frame: Float64Array, cars: Float64Array, eye: THREE.Camera): void {
    if (!this.liveDraw) {
      this.liveDraw = this.car.drawn;
      this.liveShown = this.presentOnly().map((root) => root.visible);
    }
    this.car.pose(frame);
    this.car.showPastLamps(frame);
    this.car.setDraw(true, true, false);
    for (const root of this.presentOnly()) root.visible = false;
    this.field?.showPast(cars, eye, frame[frameIndex.time] ?? 0);
    this.commitPoses();
  }

  posePresent(): void {
    if (!this.liveDraw || !this.liveFrame) return;
    this.car.pose(this.liveFrame);
    this.car.showLiveLamps();
    this.car.setDraw(...this.liveDraw);
    this.liveDraw = null;
    this.presentOnly().forEach((root, k) => {
      root.visible = this.liveShown[k] ?? true;
    });
    if (this.cars) this.field?.showPresent(this.cars, this.camera);
    this.commitPoses();
  }

  private presentOnly(): THREE.Object3D[] {
    return [this.racingLine.root, this.safetyCar.root, this.debris.root];
  }

  private commitPoses(): void {
    for (const object of this.moving)
      if (object.visible) object.updateMatrixWorld();
  }

  private stepFieldLamps(time: number): void {
    if (this.cars) this.field?.stepLamps(this.cars, time);
  }

  update(frame: Float64Array): void {
    this.liveFrame = frame;
    const time = frame[frameIndex.time] ?? 0;
    this.stepFieldLamps(time);
    if (this.cinematic) this.showPast(time);
    this.car.update(frame);
    this.updateContact(frame);
    this.racingLine.update(
      (frame[frameIndex.distFromStart] ?? 0) * this.lapScale,
      Math.abs(frame[frameIndex.speed] ?? 0),
    );

    if (this.cinematic) this.applyCinematic(this.cinematic);
    else this.applyDriverView(frame);

    const [, , , , , , , , , , , , eyeX, eyeY, eyeZ] =
      this.camera.matrixWorld.elements;
    this.grid?.update(frame);
    const shown = (k: number) =>
      this.cinematic !== null || (frame[frameIndex.camera + k] ?? 0) !== 0;
    const onboard =
      this.eye
        .set(eyeX, eyeY, eyeZ)
        .distanceToSquared(
          this.carPosition.setFromMatrixPosition(this.car.root.matrix),
        ) <
      onboardReach * onboardReach;
    this.car.setDraw(shown(19), shown(20), onboard);
    this.atmosphere.shock = this.shockLevel(time);
    const lit = this.lights.lit(time - this.signalAt);
    setStartLights(this.cinematic ? 0 : lit);
    this.updateSky(time, eyeX, eyeY, eyeZ);
    this.people?.update(this.eye.set(eyeX, eyeY, eyeZ));
    this.trees?.update(
      this.eye,
      this.sunlight.direction,
      this.sunShine
        .copy(this.sunlight.sun.color)
        .multiplyScalar(this.sunlight.sun.intensity),
    );
    this.applyWeather(frame, onboard);
    this.debris.update(time);
  }

  private updateSky(
    time: number,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
  ): void {
    const sky = this.sky.update(time, time, eyeX, eyeY);
    const [focusX, focusY, focusZ] = this.cinematic?.target ?? [
      eyeX,
      eyeY,
      eyeZ,
    ];
    this.sunlight.update(sky, focusX, focusY, focusZ);
    this.atmosphere.sunDirection.copy(this.sunlight.direction);
    this.skyBox.update(this.sunlight.direction, eyeX, eyeY, this.scene);
  }

  commitMoves(): void {
    for (const object of this.moving)
      if (object.visible) object.updateMatrixWorld();
    this.sunlight.commit();
    if (this.warming) return;
    this.viewMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this.viewFrustum.setFromProjectionMatrix(
      this.viewMatrix,
      this.camera.coordinateSystem,
      this.camera.reversedDepth,
    );
    this.mirrorViews = this.car.mirrorViews();
    this.culler.update(this.seen, this.sunlight.cascadeViews);
  }

  hideUnseenCrew(): void {
    if (!this.crew) return;
    const { root } = this.crew;
    if (!this.warming) {
      this.crewBounds.center.setFromMatrixPosition(root.matrix);
      root.visible =
        this.crewOut &&
        (this.seen.intersectsSphere(this.crewBounds) ||
          this.sunlight.intersectsSphere(this.crewBounds));
    }
    if (!root.visible) return;
    this.crew.prepare();
    root.updateMatrixWorld();
  }

  async warmUp(
    renderer: THREE.WebGPURenderer,
    draw: () => void,
    mirrors: boolean,
  ): Promise<void> {
    this.warming = true;
    this.crew?.bake();
    if (mirrors) this.addDebrisCars();
    await uploadEverything(
      renderer,
      this.scene,
      () => {
        draw();
        this.sunlight.freeze();
        if (mirrors) this.warmMirrors(renderer);
      },
      !mirrors,
    );
    this.warming = false;
    releaseCpuCopies(this.road, this.culler.retained());
    releaseUploadedImages(renderer, this.scene);
  }

  get racingLineData(): RacingLineData {
    return this.racingLine.data;
  }

  warmRest(renderer: THREE.WebGPURenderer, draw: () => void): Promise<void> {
    this.addDebrisCars();
    return uploadLater(renderer, this.scene, draw, () => {
      this.sunlight.redraw();
    });
  }

  updateTyres(frame: Float64Array, tyres: TyreInfo): void {
    this.smoke.update(frame, tyres, this.car.wheelRadii());
    this.car.setCompound(tyres.compound);
    this.compound = tyres.compound;
    this.car.setTyreCondition(tyres.wheels);
    this.damageLog.recordTyres(frame[frameIndex.time] ?? 0, tyres.wheels);
    this.wear =
      tyres.wheels.reduce((sum, wheel) => sum + wheel.wear, 0) /
      Math.max(1, tyres.wheels.length);
  }

  resize(width: number, height: number, pixelRatio = 1): void {
    this.field?.resize(height * pixelRatio);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.sunlight.refit();
  }
}
