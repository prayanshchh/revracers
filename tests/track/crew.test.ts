import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { readModel } from "../support/gltf.ts";
import { repoRoot } from "../support/repo.ts";

const file = path.join(repoRoot, "content/tracks/hill-country/crew.glb");
const header = readFileSync(file).subarray(0, 40).toString("latin1");
const lfsPointer = header.startsWith("version https://git-lfs");
const source = readFileSync(
  path.join(repoRoot, "apps/client/src/game/pit-crew.ts"),
  "utf8",
);
const sides = ["l", "r"];
const solved = [
  "pelvis",
  "spine_01",
  "spine_02",
  "spine_03",
  "neck_01",
  "Head",
  ...sides.flatMap((s) => [
    `clavicle_${s}`,
    `upperarm_${s}`,
    `lowerarm_${s}`,
    `hand_${s}`,
    `thigh_${s}`,
    `calf_${s}`,
    `foot_${s}`,
    `ball_${s}`,
    ...["thumb", "index", "middle", "ring", "pinky"].flatMap((f) =>
      [1, 2, 3].map((k) => `${f}_0${String(k)}_${s}`),
    ),
  ]),
];

describe.skipIf(lfsPointer)("pit crew model", () => {
  test("has every clip the crew plays and every joint the body solver moves", async () => {
    const root = (await readModel(file)).getRoot();
    expect(root.listSkins().length).toBeGreaterThan(0);
    const clips = root.listAnimations().map((a) => a.getName());
    const chooser = source.match(/const gaitClips = ([^;]+);/)?.[1] ?? "";
    const played = [
      ...chooser.matchAll(/"(\w+)"/g),
      ...source.matchAll(/actions\.get\("(\w+)"\)/g),
    ].map((m) => m[1] ?? "");
    expect(played).toEqual(expect.arrayContaining(["ready", "walk", "run"]));
    for (const clip of played) expect(clips).toContain(clip);
    const joints = (root.listSkins()[0]?.listJoints() ?? []).map((j) =>
      j.getName(),
    );
    expect(joints).toEqual(expect.arrayContaining(solved));
  });
});
