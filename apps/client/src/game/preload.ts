import * as THREE from "three/webgpu";
import { DefaultLoadingManager } from "three/webgpu";
import "./asset-store.ts";

const settleFrames = 3;
let loading = 0;
let waiting: (() => void)[] = [];
const itemStart = DefaultLoadingManager.itemStart.bind(DefaultLoadingManager);
const itemEnd = DefaultLoadingManager.itemEnd.bind(DefaultLoadingManager);
DefaultLoadingManager.itemStart = (url: string) => {
  loading += 1;
  itemStart(url);
};
DefaultLoadingManager.itemEnd = (url: string) => {
  loading -= 1;
  itemEnd(url);
  if (loading > 0) return;
  for (const resolve of waiting) resolve();
  waiting = [];
};

function loaded(): Promise<void> {
  if (loading <= 0) return Promise.resolve();
  return new Promise((resolve) => waiting.push(resolve));
}

interface GpuBackend {
  device: GPUDevice;
}

interface UploadRecord {
  initialized?: boolean;
  version?: number;
  isDefaultTexture?: boolean;
}

interface UploadedTextures {
  has(texture: THREE.Texture): boolean;
  get(texture: THREE.Texture): UploadRecord;
}

const releasable = new Set<THREE.Texture>();

export function releaseOnceUploaded<T extends THREE.Texture>(texture: T): T {
  releasable.add(texture);
  return texture;
}

function fileImage(data: unknown): data is ImageBitmap | HTMLImageElement {
  return data instanceof ImageBitmap || data instanceof HTMLImageElement;
}

function pixelData(data: unknown): data is { width: number; height: number } {
  return (
    typeof data === "object" &&
    data !== null &&
    ArrayBuffer.isView((data as { data?: unknown }).data)
  );
}

function drawnCanvas(
  data: unknown,
): data is OffscreenCanvas | HTMLCanvasElement {
  return (
    (typeof OffscreenCanvas !== "undefined" &&
      data instanceof OffscreenCanvas) ||
    (typeof HTMLCanvasElement !== "undefined" &&
      data instanceof HTMLCanvasElement)
  );
}

function freeable(data: unknown): data is { width: number; height: number } {
  return fileImage(data) || pixelData(data) || drawnCanvas(data);
}

function slotTextures(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials: THREE.Material[] = [object.material as THREE.Material]
      .flat()
      .filter(Boolean);
    for (const material of materials)
      for (const value of Object.values(material) as unknown[])
        if (value instanceof THREE.Texture && fileImage(value.source.data))
          releasable.add(value as THREE.Texture);
  });
}

function release(texture: THREE.Texture, uploaded: UploadedTextures): boolean {
  if (!uploaded.has(texture)) return false;
  const record = uploaded.get(texture);
  if (record.initialized !== true || record.isDefaultTexture === true)
    return false;
  if (record.version !== texture.version) return false;
  const data: unknown = texture.source.data;
  if (!freeable(data)) return false;
  texture.source.data = { width: data.width, height: data.height };
  if (data instanceof ImageBitmap) data.close();
  if (drawnCanvas(data)) {
    data.width = 0;
    data.height = 0;
  }
  return true;
}

function uploadedBy(renderer: THREE.WebGPURenderer): UploadedTextures {
  return (renderer as unknown as { _textures: UploadedTextures })._textures;
}

export function releaseUploadedImages(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
): void {
  slotTextures(scene);
  const uploaded = uploadedBy(renderer);
  for (const texture of releasable) release(texture, uploaded);
  releasable.clear();
}

let gpu: THREE.WebGPURenderer | null = null;
const pictures = new Map<string, Promise<void>>();
const ticker = new MessageChannel();
ticker.port1.onmessage = uploadArrived;

export function useRenderer(renderer: THREE.WebGPURenderer): void {
  gpu = renderer;
}

function uploadArrived(): void {
  if (!gpu) return;
  const uploaded = uploadedBy(gpu);
  for (const texture of releasable) {
    if (!(texture.source.data instanceof ImageBitmap)) continue;
    gpu.initTexture(texture);
    if (release(texture, uploaded)) releasable.delete(texture);
  }
}

export async function loadPicture(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to load ${url}`);
  return createImageBitmap(await response.blob(), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
}

THREE.ImageLoader.prototype.load = function (
  this: THREE.ImageLoader,
  url,
  onLoad,
  _onProgress,
  onError,
) {
  const { manager } = this;
  const resolved = manager.resolveURL(`${this.path}${url}`);
  manager.itemStart(resolved);
  const arriving = loadPicture(resolved).then(
    (picture) => {
      onLoad?.(picture as unknown as HTMLImageElement);
      ticker.port2.postMessage(null);
    },
    (error: unknown) => {
      onError?.(error);
      manager.itemError(resolved);
    },
  );
  void arriving.finally(() => {
    if (pictures.get(resolved) === arriving) pictures.delete(resolved);
    manager.itemEnd(resolved);
  });
  pictures.set(resolved, arriving);
  return new Image();
};

export function picturesLoaded(urls: string[]): Promise<void> {
  return Promise.all(
    urls.map((url) => pictures.get(url) ?? Promise.resolve()),
  ).then(() => undefined);
}

const laterKey = "warmLater";

export function warmLater<T extends THREE.Object3D>(object: T): T {
  object.userData[laterKey] = true;
  return object;
}

type Pass = "all" | "now" | "later";

function reveal(scene: THREE.Object3D, pass: Pass): () => void {
  const hidden: THREE.Object3D[] = [];
  const culled: THREE.Object3D[] = [];
  const visit = (object: THREE.Object3D, inLater: boolean) => {
    const late = inLater || object.userData[laterKey] === true;
    if (late && pass === "now") return;
    if (late || pass !== "later") {
      if (!object.visible) hidden.push(object);
      object.visible = true;
      if (object.frustumCulled) culled.push(object);
      object.frustumCulled = false;
    }
    for (const child of object.children) visit(child, late);
  };
  visit(scene, false);
  return () => {
    for (const object of hidden) object.visible = false;
    for (const object of culled) object.frustumCulled = true;
  };
}

export function showLater(scene: THREE.Object3D): () => void {
  return reveal(scene, "later");
}

function drawEverything(
  scene: THREE.Scene,
  draw: () => void,
  pass: Pass,
): void {
  const restore = reveal(scene, pass);
  try {
    draw();
  } finally {
    restore();
  }
}

interface PipelineCache {
  updateForRender(renderObject: unknown): void;
  getForRender(renderObject: unknown, promises: Promise<void>[]): unknown;
}

export function startPipelines(
  renderer: THREE.WebGPURenderer,
  draw: () => void,
): Promise<void> {
  const pipelines = (renderer as unknown as { _pipelines: PipelineCache })
    ._pipelines;
  const pending: Promise<void>[] = [];
  pipelines.updateForRender = (renderObject) => {
    pipelines.getForRender(renderObject, pending);
  };
  try {
    draw();
  } finally {
    delete (pipelines as Partial<PipelineCache>).updateForRender;
  }
  return Promise.all(pending).then(() => undefined);
}

export async function uploadEverything(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  draw: () => void,
  deferLater: boolean,
  pipelinesReady: () => void,
): Promise<void> {
  const pass = deferLater ? "now" : "all";
  await startPipelines(renderer, () => {
    drawEverything(scene, draw, pass);
  });
  pipelinesReady();
  drawEverything(scene, draw, pass);
  await loaded();
  drawEverything(scene, draw, pass);
  for (let frame = 0; frame < settleFrames; frame += 1) draw();
  await (
    renderer.backend as unknown as GpuBackend
  ).device.queue.onSubmittedWorkDone();
}

interface NodeFrames {
  _nodes: { nodeFrame: { update(): void } };
}

function freshFrame(renderer: THREE.WebGPURenderer): void {
  (renderer as unknown as NodeFrames)._nodes.nodeFrame.update();
}

export async function uploadLater(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  draw: () => void,
  refresh: () => void,
): Promise<void> {
  refresh();
  freshFrame(renderer);
  const ready = startPipelines(renderer, () => {
    drawEverything(scene, draw, "later");
  });
  refresh();
  freshFrame(renderer);
  draw();
  await ready;
}
