import crewUrl from "../../../../content/tracks/hill-country/crew.glb?url";
import roadUrl from "../../../../content/tracks/hill-country/road.glb?url";
import { circuitFiles, circuitOf, engineDownloads } from "./circuits.ts";
import { crowdFiles } from "./crowd.ts";
import { prefetch } from "./preload.ts";
import { groundFiles } from "./road.ts";
import { skyDownloads } from "./skybox.ts";
import { musicFiles } from "./sound/music.ts";
import { carFile, teams } from "./teams.ts";
import { upgradeAll, upgradeFiles } from "./upgrades.ts";

const raceSkies = ["circuit"];
const playerParts = [
  "car.glb",
  "albedo.jpg",
  "orm.jpg",
  "bump.jpg",
  "wheel-face.jpg",
  "glove.jpg",
  "crew.jpg",
];
const fieldParts = ["lod.glb", "albedo-lod.jpg", "orm-lod.jpg"];

function gameFiles(team: string): string[] {
  return [
    ...upgradeFiles(),
    ...musicFiles(),
    ...teams.flatMap((t) => fieldParts.map((part) => carFile(t.id, part))),
    ...playerParts.map((part) => carFile(team, part)),
    carFile("shared", "tyre.png"),
    ...engineDownloads(circuitOf("hill-country")),
    ...circuitFiles(circuitOf("hill-country")),
    ...groundFiles,
    ...crowdFiles,
    crewUrl,
    roadUrl,
    ...skyDownloads(raceSkies),
  ];
}

export async function warmGame(
  team: string,
  upgraded: () => void,
): Promise<void> {
  const files = gameFiles(team);
  if ((await upgradeAll()) > 0) upgraded();
  await prefetch(files);
}
