import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NodeIO, PropertyType } from "@gltf-transform/core";
import {
  ALL_EXTENSIONS,
  EXTMeshoptCompression,
} from "@gltf-transform/extensions";
import { dedup, prune, reorder } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

const floatType = 5126;
const grids = {
  POSITION: 2 ** -12,
  NORMAL: 2 ** -9,
  TEXCOORD_0: 2 ** -12,
  TEXCOORD_1: 2 ** -12,
};
const cockpit = "steering-wheel";

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

function snap(document) {
  const done = new Set();
  for (const mesh of document.getRoot().listMeshes())
    for (const primitive of mesh.listPrimitives())
      for (const semantic of primitive.listSemantics()) {
        const accessor = primitive.getAttribute(semantic);
        const grid = grids[semantic];
        if (!grid || done.has(accessor)) continue;
        if (accessor.getComponentType() !== floatType) continue;
        done.add(accessor);
        const values = accessor.getArray();
        for (let i = 0; i < values.length; i++)
          values[i] = Math.round(values[i] / grid) * grid;
      }
}

function disposeTree(node) {
  for (const child of node.listChildren()) disposeTree(child);
  node.dispose();
}

function keepOnly(document, wanted) {
  for (const scene of document.getRoot().listScenes())
    for (const top of scene.listChildren())
      for (const part of top.listChildren())
        if (!wanted(part.getName())) disposeTree(part);
}

async function pack(from, to, wanted) {
  const document = await io.read(from);
  if (wanted) keepOnly(document, wanted);
  snap(document);
  await document.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR] }),
    reorder({ encoder: MeshoptEncoder, target: "size" }),
    prune({ keepAttributes: true, keepLeaves: true }),
  );
  document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({
      method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
    });
  const binary = await io.writeBinary(document);
  writeFileSync(to, binary);
  return binary.length;
}

const root = path.resolve(process.argv[2] ?? "content/cars");
const teams = readdirSync(root).filter((team) =>
  existsSync(path.join(root, team, "car.glb")),
);
for (const team of teams) {
  const lite = path.join(root, team, "lite");
  mkdirSync(lite, { recursive: true });
  const sizes = [
    await pack(
      path.join(root, team, "car.glb"),
      path.join(lite, "car.bin"),
      (name) => name !== cockpit,
    ),
    await pack(
      path.join(root, team, "car.glb"),
      path.join(lite, "cockpit.bin"),
      (name) => name === cockpit,
    ),
    await pack(path.join(root, team, "lod.glb"), path.join(lite, "lod.bin")),
  ];
  process.stdout.write(
    `${team}: ${sizes.map((size) => (size / 1e6).toFixed(2)).join(" + ")} MB raw\n`,
  );
}
