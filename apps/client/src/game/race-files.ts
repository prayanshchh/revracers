import crewUrl from "../../../../content/tracks/hill-country/crew.glb?url";
import roadUrl from "../../../../content/tracks/hill-country/road.glb?url";
import { type Circuit, circuitFiles, engineDownloads } from "./circuits.ts";
import { crowdAtlas, crowdFiles } from "./crowd.ts";
import { desertFiles } from "./desert-ground.ts";
import { groundFiles } from "./road.ts";
import {
  boulevard,
  type Species,
  treeDownloads,
  woodland,
} from "./scenery-trees.ts";
import { streetFiles } from "./street-ground.ts";
import { carFile, teams } from "./teams.ts";
import { trainingTextures, trainingUpgrades } from "./training-files.ts";
import { venueFiles } from "./venue-dressing.ts";
import { landmarkFiles } from "./venue-landmarks.ts";

const playerParts = [
  "car.glb",
  "albedo.jpg",
  "orm.jpg",
  "bump.jpg",
  "wheel-face.jpg",
  "glove.jpg",
];
const fieldParts = ["lod.glb", "albedo-lod.jpg", "orm-lod.jpg"];
const tyreParts = ["tyre.png", "tyre-condition.png"];

export const roadFile = roadUrl;
export const crewFile = crewUrl;

function builtFiles(circuit: Circuit): string[] | null {
  if (circuit.ground === "street") return streetFiles;
  return circuit.ground === "desert" ? desertFiles : null;
}

function groundOf(circuit: Circuit): string[] {
  const built = builtFiles(circuit);
  if (built) return [...trainingTextures, ...built, ...crowdAtlas, crewUrl];
  return [
    roadUrl,
    ...groundFiles,
    ...venueFiles,
    ...landmarkFiles,
    crewUrl,
    ...crowdFiles,
  ];
}

export function treeKinds(circuit: Circuit): Species[] {
  if (circuit.trees) return circuit.flora ?? woodland;
  return circuit.city ? boulevard : [];
}

function fleetOf(team: string, rivals: string[]): string[] {
  return rivals.length > 0
    ? [...new Set([team, ...rivals])]
    : teams.map((each) => each.id);
}

export function sceneFiles(
  circuit: Circuit,
  team: string,
  rivals: string[],
): string[] {
  return [
    ...circuitFiles(circuit),
    ...groundOf(circuit),
    ...(circuit.trees ? [circuit.trees] : []),
    ...(circuit.skyline ? [circuit.skyline] : []),
    ...(circuit.parked ? [circuit.parked] : []),
    ...treeDownloads(treeKinds(circuit)),
    ...playerParts.map((part) => carFile(team, part)),
    ...tyreParts.map((part) => carFile("shared", part)),
    ...fleetOf(team, rivals).flatMap((each) =>
      fieldParts.map((part) => carFile(each, part)),
    ),
  ];
}

export function raceFiles(
  circuit: Circuit,
  team: string,
  rivals: string[],
): string[] {
  return [
    ...engineDownloads(circuit),
    ...sceneFiles(circuit, team, rivals),
    ...fleetOf(team, rivals).map((each) => carFile(each, "crew.jpg")),
    ...(builtFiles(circuit) ? Object.values(trainingUpgrades) : []),
  ];
}
