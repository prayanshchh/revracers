import * as THREE from "three/webgpu";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Celebrant } from "./celebrant.ts";
import { gltfLoader } from "./gltf-loader.ts";
import { crewKit } from "./pit-crew.ts";
import { surface } from "./road.ts";

const kitMaterials = new Set(["crew suit", "crew shell"]);
const anisotropy = 4;

export function loadCrewModel(url: string): Promise<THREE.Object3D> {
  return gltfLoader()
    .loadAsync(url)
    .then((gltf) => gltf.scene);
}

export class Wardrobe {
  private readonly made: THREE.Material[] = [];
  private readonly kits: THREE.Texture[] = [];
  private readonly sets = new Map<string, Map<string, THREE.Material>>();

  private constructor(private readonly model: THREE.Object3D) {}

  static async open(
    model: Promise<THREE.Object3D>,
    teams: string[],
  ): Promise<Wardrobe> {
    const wardrobe = new Wardrobe(await model);
    await Promise.all([...new Set(teams)].map((team) => wardrobe.stock(team)));
    return wardrobe;
  }

  private async stock(team: string): Promise<void> {
    const kit = await crewKit(team, anisotropy);
    this.kits.push(kit);
    const set = new Map<string, THREE.Material>();
    this.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const source = object.material as THREE.MeshStandardMaterial;
      if (set.has(source.name)) return;
      const copy = source.clone();
      if (kitMaterials.has(source.name)) copy.map = kit;
      const material = surface(copy, anisotropy);
      this.made.push(material);
      set.set(source.name, material);
    });
    this.sets.set(team, set);
  }

  figure(team: string, seed: number): Celebrant {
    const body = cloneRig(this.model);
    const set = this.sets.get(team);
    body.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !set) return;
      const current = object.material as THREE.Material;
      object.material = set.get(current.name) ?? current;
    });
    return new Celebrant(body, seed);
  }

  dispose(): void {
    for (const material of this.made) material.dispose();
    for (const kit of this.kits) kit.dispose();
  }
}
