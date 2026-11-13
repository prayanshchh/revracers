import * as THREE from "three/webgpu";
import { DefaultLoadingManager } from "three/webgpu";
import { currentPhase } from "./download-phase.ts";
import { takeEarly } from "./early.ts";

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

const sizes = JSON.parse(
  document.querySelector("[data-asset-sizes]")?.textContent ?? "{}",
) as Record<string, number>;
const wire = JSON.parse(
  document.querySelector("[data-asset-wire]")?.textContent ?? "{}",
) as Record<string, number>;
let expectedBytes = 0;
let receivedBytes = 0;
const declared = new Set<string>();
const plainFetch = globalThis.fetch.bind(globalThis);
const storeName = "revracers-assets";
let store: Promise<Cache | null> | null = null;

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input, location.href);
}

function wireShare(path: string): number {
  const size = sizes[path];
  const sent = wire[path];
  return size && sent ? sent / size : 1;
}

function expectedSize(url: URL, response: Response): number {
  const known = sizes[url.pathname];
  if (known !== undefined) return known;
  if (response.headers.has("content-encoding")) return 0;
  return Number(response.headers.get("content-length") ?? 0);
}

function buildAsset(
  url: URL,
  input: RequestInfo | URL,
  init?: RequestInit,
): boolean {
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  return (
    method.toUpperCase() === "GET" &&
    url.origin === location.origin &&
    sizes[url.pathname] !== undefined
  );
}

function assetStore(): Promise<Cache | null> {
  store ??=
    "caches" in globalThis
      ? caches.open(storeName).catch(() => null)
      : Promise.resolve(null);
  return store;
}

async function keptFetch(
  url: URL,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const kept = await assetStore();
  const hit = await kept?.match(url.href).catch(() => undefined);
  if (hit) return hit;
  const response = await plainFetch(input, init);
  if (kept && response.status === 200)
    void kept.put(url.href, response.clone()).catch(() => undefined);
  return response;
}

async function forgetOldAssets(): Promise<void> {
  const kept = await assetStore();
  if (!kept) return;
  for (const request of await kept.keys())
    if (sizes[new URL(request.url).pathname] === undefined)
      await kept.delete(request);
}

function takeHeld(
  url: URL,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> | null {
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  if (method.toUpperCase() !== "GET") return null;
  return takeEarly(url.href)?.catch(() => plainFetch(input, init)) ?? null;
}

if (Object.keys(sizes).length > 0)
  setTimeout(() => {
    void forgetOldAssets().catch(() => undefined);
  }, 10_000);

globalThis.fetch = async (input, init) => {
  const mine = currentPhase();
  const url = requestUrl(input);
  const response = await (takeHeld(url, input, init) ??
    (buildAsset(url, input, init)
      ? keptFetch(url, input, init)
      : plainFetch(input, init)));
  const size =
    url.origin === location.origin && url.protocol === location.protocol
      ? expectedSize(url, response)
      : 0;
  if (!response.ok || !response.body || size <= 0) return response;
  const share = wireShare(url.pathname);
  if (!declared.delete(url.pathname)) {
    expectedBytes += size * share;
    mine.expected += size * share;
  }
  const counted = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      receivedBytes += chunk.byteLength * share;
      mine.received += chunk.byteLength * share;
      controller.enqueue(chunk);
    },
  });
  return new Response(response.body.pipeThrough(counted), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

export async function prefetch(urls: string[], lanes = 2): Promise<void> {
  const kept = await assetStore();
  if (!kept) return;
  const wanted = [
    ...new Set(urls.map((url) => new URL(url, location.href).href)),
  ].filter((href) => sizes[new URL(href).pathname] !== undefined);
  const queue = [...wanted];
  const lane = async (): Promise<void> => {
    for (let href = queue.shift(); href; href = queue.shift()) {
      const hit = await kept.match(href).catch(() => undefined);
      if (!hit) {
        const response = await plainFetch(href, { priority: "low" }).catch(
          () => null,
        );
        if (response?.status === 200)
          await kept.put(href, response).catch(() => undefined);
        else await response?.body?.cancel().catch(() => undefined);
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
}

export function downloadsFromNow(): () => number {
  const expected = expectedBytes;
  const received = receivedBytes;
  return () =>
    expectedBytes > expected
      ? (receivedBytes - received) / (expectedBytes - expected)
      : 0;
}

export function expectDownloads(urls: string[]): void {
  const phase = currentPhase();
  phase.plans += 1;
  for (const url of urls) {
    const path = new URL(url, location.href).pathname;
    const size = sizes[path];
    if (size === undefined || declared.has(path)) continue;
    declared.add(path);
    expectedBytes += size * wireShare(path);
    phase.expected += size * wireShare(path);
  }
}

export function loaded(): Promise<void> {
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

export function releaseUploadedImages(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
): void {
  slotTextures(scene);
  const uploaded = (renderer as unknown as { _textures: UploadedTextures })
    ._textures;
  for (const texture of releasable) {
    if (!uploaded.has(texture)) continue;
    const record = uploaded.get(texture);
    if (record.initialized !== true || record.isDefaultTexture === true)
      continue;
    if (record.version !== texture.version) continue;
    const data: unknown = texture.source.data;
    if (!freeable(data)) continue;
    texture.source.data = { width: data.width, height: data.height };
    if (data instanceof ImageBitmap) data.close();
    if (drawnCanvas(data)) {
      data.width = 0;
      data.height = 0;
    }
  }
  releasable.clear();
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
