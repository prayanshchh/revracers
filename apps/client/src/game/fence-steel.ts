import * as THREE from "three/webgpu";

const galvanised = new THREE.Color(0.62, 0.64, 0.66);

export function galvanisedSteel(material: THREE.Material): void {
  if (!(material instanceof THREE.MeshStandardNodeMaterial)) return;
  material.color.copy(galvanised);
  material.metalness = 0.2;
  material.roughness = 0.55;
  material.needsUpdate = true;
}
