import type { Shot, ShotPoint } from "./buildup-shots.ts";
import type { MapLook, MapPose } from "./circuit-map.ts";
import type { Season } from "./scenery-look.ts";

export type MapStage = "map-sectors" | "map-zones" | "map-turns";

export interface BuildUpVenue {
  event: string;
  place: string;
  city: string;
  fact: string;
  turns: number;
  country: string;
  temperatures: Record<string, number>;
  season: Season;
  title: Shot;
  weather: Shot;
  feature: Shot;
  featureSeconds: number;
  maps: Record<MapStage, [MapPose, MapPose]>;
  mapLook: MapLook;
  gridCards: boolean;
}

function at(distance: number, lateral: number, height: number): ShotPoint {
  return { distance, lateral, height };
}

function orbit(
  target: [number, number, number],
  azimuth: number,
  elevation: number,
  distance: number,
  fov: number,
): MapPose {
  return { azimuth, elevation, distance, target, fov };
}

const hillCentre: [number, number, number] = [780, 0, -130];
const hillZones: [number, number, number] = [880, 0, -230];
const hillTurns: [number, number, number] = [800, 30, -60];

const hillCountry: BuildUpVenue = {
  event: "Hill Country Grand Prix 2026",
  place: "Austin - USA",
  city: "Austin",
  turns: 20,
  fact: "Turn 1 sits at the top of a steep climb from the grid, with a wide apex that invites several lines into the corner.",
  country: "US",
  temperatures: { spring: 24, summer: 33, autumn: 26, winter: 15 },
  season: "autumn",
  title: {
    eyeFrom: at(1716, 66, 56),
    eyeTo: at(1672, 74, 66),
    lookFrom: at(1262, 0, 6),
    lookTo: at(1292, 0, 10),
    fov: 44,
  },
  weather: {
    eyeFrom: at(1420, 60, 74),
    eyeTo: at(1450, 64, 82),
    lookFrom: at(4080, 0, 8),
    lookTo: at(4110, 0, 10),
    fov: 40,
  },
  feature: {
    eyeFrom: at(322, -3, 0.8),
    eyeTo: at(352, -3, 1),
    lookFrom: at(640, 0, 30),
    lookTo: at(640, 0, 34),
    fov: 32,
  },
  featureSeconds: 6,
  gridCards: false,
  mapLook: {
    centre: [780, -130],
    top: [0.15, 0.27, 0.32],
    lit: [0.055, 0.11, 0.14],
    shadow: [0.055, 0.11, 0.14],
    parking: [0.035, 0.07, 0.085],
    water: [0.02, 0.05, 0.08],
    ground: null,
  },
  maps: {
    "map-sectors": [
      orbit(hillCentre, 2.14, 0.68, 2500, 34),
      orbit(hillCentre, 2.24, 0.62, 2380, 34),
    ],
    "map-zones": [
      orbit(hillZones, -1.22, 0.56, 2500, 34),
      orbit(hillZones, -1.32, 0.5, 2400, 34),
    ],
    "map-turns": [
      orbit(hillTurns, -1.02, 0.26, 2500, 30),
      orbit(hillTurns, -0.86, 0.2, 2380, 30),
    ],
  },
};

const boulevardCentre: [number, number, number] = [-370, 0, -900];
const boulevardTurns: [number, number, number] = [-370, 20, -880];
const boulevardWeather: Shot = {
  eyeFrom: at(4290, 6.5, 6.5),
  eyeTo: at(4306, 6, 6.2),
  lookFrom: at(4470, -1, 7),
  lookTo: at(4480, -1, 7),
  fov: 52,
};

const neonBoulevard: BuildUpVenue = {
  event: "Neon Boulevard Grand Prix 2026",
  place: "Las Vegas - USA",
  city: "Las Vegas",
  turns: 17,
  fact: "The run down the Boulevard is close to two kilometres at full throttle, the longest flat-out stretch of the season.",
  country: "US",
  temperatures: { spring: 19, summer: 32, autumn: 12, winter: 8 },
  season: "autumn",
  title: {
    eyeFrom: at(4846, -175, 40),
    eyeTo: at(4870, -165, 44),
    lookFrom: at(4846, 130, 40),
    lookTo: at(4866, 130, 42),
    fov: 44,
  },
  weather: boulevardWeather,
  feature: {
    eyeFrom: boulevardWeather.eyeTo,
    eyeTo: boulevardWeather.eyeTo,
    lookFrom: boulevardWeather.lookTo,
    lookTo: boulevardWeather.lookTo,
    fov: boulevardWeather.fov,
  },
  featureSeconds: 1.2,
  gridCards: true,
  mapLook: {
    centre: [-370, -900],
    top: [0.25, 0.35, 0.375],
    lit: [0.17, 0.235, 0.255],
    shadow: [0.06, 0.098, 0.106],
    parking: [0.09, 0.15, 0.165],
    water: [0.04, 0.08, 0.1],
    ground: [0.12, 0.215, 0.235],
  },
  maps: {
    "map-sectors": [
      orbit(boulevardCentre, 1.05, 0.6, 3450, 34),
      orbit(boulevardCentre, 1.13, 0.56, 3300, 34),
    ],
    "map-zones": [
      orbit(boulevardCentre, 1.1, 0.56, 3400, 34),
      orbit(boulevardCentre, 1.0, 0.52, 3250, 34),
    ],
    "map-turns": [
      orbit(boulevardTurns, 1.4, 0.22, 2500, 30),
      orbit(boulevardTurns, 1.46, 0.19, 2380, 30),
    ],
  },
};

const venues: Record<string, BuildUpVenue> = {
  "hill-country": hillCountry,
  "neon-boulevard": neonBoulevard,
};

export function buildUpVenue(circuit: string): BuildUpVenue {
  return venues[circuit] ?? hillCountry;
}

export function airTemperature(
  venue: BuildUpVenue,
  season: Season,
  rain: number,
  overcast: boolean,
): number {
  return (venue.temperatures[season] ?? 27) - rain * 3 - (overcast ? 2 : 0);
}
