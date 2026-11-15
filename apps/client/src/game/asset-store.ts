import { currentPhase } from "./download-phase.ts";
import { takeEarly } from "./early.ts";

interface Transfer {
  received: number;
  background: boolean;
  dropped: boolean;
  followers: Set<(bytes: number) => void>;
  stored: Promise<boolean>;
  stop: () => void;
}

type Phase = ReturnType<typeof currentPhase>;

interface Meter {
  paths: Set<string>;
  expected: number;
  received: number;
}

const laneCount = 3;
const laneTries = 3;
const sizes = JSON.parse(
  document.querySelector("[data-asset-sizes]")?.textContent ?? "{}",
) as Record<string, number>;
const wire = JSON.parse(
  document.querySelector("[data-asset-wire]")?.textContent ?? "{}",
) as Record<string, number>;
const meters = new Set<WeakRef<Meter>>();
const expectedPaths = new WeakMap<Phase, Set<string>>();
const readPaths = new WeakMap<Phase, Set<string>>();
const plainFetch = globalThis.fetch.bind(globalThis);
const storeName = "revracers-assets";
let store: Promise<Cache | null> | null = null;
const transfers = new Map<string, Transfer>();
let queue: string[] = [];
let lanes = 0;
let held = false;
const failures = new Map<string, number>();

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input, location.href);
}

function hrefOf(url: string): string {
  return new URL(url, location.href).href;
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

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
}

function buildAsset(
  url: URL,
  input: RequestInfo | URL,
  init?: RequestInit,
): boolean {
  return (
    methodOf(input, init) === "GET" &&
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

async function forgetOldAssets(): Promise<void> {
  const kept = await assetStore();
  if (!kept) return;
  for (const request of await kept.keys())
    if (sizes[new URL(request.url).pathname] === undefined)
      await kept.delete(request);
}

function eachMeter(visit: (meter: Meter) => void): void {
  for (const reference of meters) {
    const meter = reference.deref();
    if (meter) visit(meter);
    else meters.delete(reference);
  }
}

function credit(phase: Phase, path: string, bytes: number): void {
  phase.received += bytes;
  eachMeter((meter) => {
    if (meter.paths.has(path)) meter.received += bytes;
  });
}

function pathsOf(sets: WeakMap<Phase, Set<string>>, phase: Phase): Set<string> {
  const known = sets.get(phase);
  if (known) return known;
  const paths = new Set<string>();
  sets.set(phase, paths);
  return paths;
}

function expect(phase: Phase, path: string, bytes: number): void {
  const paths = pathsOf(expectedPaths, phase);
  if (paths.has(path)) return;
  paths.add(path);
  phase.expected += bytes;
  eachMeter((meter) => {
    if (meter.paths.has(path)) return;
    meter.paths.add(path);
    meter.expected += bytes;
  });
}

function firstRead(phase: Phase, path: string): boolean {
  const paths = pathsOf(readPaths, phase);
  if (paths.has(path)) return false;
  paths.add(path);
  return true;
}

function metered(transfer: Transfer): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      transfer.received += chunk.byteLength;
      for (const follow of transfer.followers) follow(chunk.byteLength);
      controller.enqueue(chunk);
    },
  });
}

function copyOf(
  response: Response,
  body: ReadableStream<Uint8Array>,
): Response {
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function begin(
  href: string,
  kept: Cache,
  background: boolean,
  request: (signal: AbortSignal) => Promise<Response>,
): { transfer: Transfer; served: Promise<Response> } {
  const abort = new AbortController();
  const transfer: Transfer = {
    received: 0,
    background,
    dropped: false,
    followers: new Set(),
    stored: Promise.resolve(false),
    stop: () => {
      abort.abort();
    },
  };
  let serve: (response: Response) => void = () => undefined;
  let refuse: (reason: unknown) => void = () => undefined;
  const served = new Promise<Response>((resolve, reject) => {
    serve = resolve;
    refuse = reject;
  });
  const save = async (): Promise<boolean> => {
    const response = await request(abort.signal);
    if (response.status !== 200 || !response.body) {
      serve(response);
      return false;
    }
    const [saved, own] = background
      ? [response.body, null]
      : response.body.tee();
    serve(own ? copyOf(response, own) : new Response(null, { status: 204 }));
    await kept.put(
      href,
      new Response(saved.pipeThrough(metered(transfer)), {
        headers: response.headers,
      }),
    );
    return true;
  };
  transfer.stored = save()
    .catch((error: unknown) => {
      refuse(error);
      return false;
    })
    .finally(() => {
      if (transfers.get(href) === transfer) transfers.delete(href);
    });
  transfers.set(href, transfer);
  return { transfer, served };
}

async function arrived(url: URL, transfer: Transfer): Promise<Response | null> {
  const stored = await transfer.stored;
  const kept = stored ? await assetStore() : null;
  return (await kept?.match(url.href).catch(() => undefined)) ?? null;
}

async function followed(
  url: URL,
  transfer: Transfer,
  phase: Phase,
): Promise<boolean> {
  const share = wireShare(url.pathname);
  expect(phase, url.pathname, (sizes[url.pathname] ?? 0) * share);
  let credited = 0;
  const follow = (bytes: number) => {
    credited += bytes * share;
    credit(phase, url.pathname, bytes * share);
  };
  follow(transfer.received);
  transfer.followers.add(follow);
  const stored = await transfer.stored;
  transfer.followers.delete(follow);
  if (stored) return true;
  credit(phase, url.pathname, -credited);
  pathsOf(readPaths, phase).delete(url.pathname);
  return false;
}

async function joined(
  url: URL,
  transfer: Transfer,
  phase: Phase,
): Promise<Response | null> {
  if (firstRead(phase, url.pathname)) await followed(url, transfer, phase);
  return arrived(url, transfer);
}

function counted(response: Response, url: URL, phase: Phase): Response {
  const size =
    url.origin === location.origin && url.protocol === location.protocol
      ? expectedSize(url, response)
      : 0;
  if (!response.ok || !response.body || size <= 0) return response;
  if (!firstRead(phase, url.pathname)) return response;
  const share = wireShare(url.pathname);
  expect(phase, url.pathname, size * share);
  const meter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      credit(phase, url.pathname, chunk.byteLength * share);
      controller.enqueue(chunk);
    },
  });
  return copyOf(response, response.body.pipeThrough(meter));
}

async function keptFetch(
  url: URL,
  phase: Phase,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const kept = await assetStore();
  if (!kept) return counted(await plainFetch(input, init), url, phase);
  const arriving = await sharedTransfer(url, phase);
  if (arriving) return arriving;
  const hit = await kept.match(url.href).catch(() => undefined);
  if (hit) return counted(hit, url, phase);
  const started = await sharedTransfer(url, phase);
  if (started) return started;
  const { served } = begin(url.href, kept, false, () =>
    plainFetch(input, init),
  );
  return counted(await served, url, phase);
}

function sharedTransfer(url: URL, phase: Phase): Promise<Response | null> {
  const running = transfers.get(url.href);
  return running ? joined(url, running, phase) : Promise.resolve(null);
}

function takeHeld(
  url: URL,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> | null {
  if (methodOf(input, init) !== "GET") return null;
  return takeEarly(url.href)?.catch(() => plainFetch(input, init)) ?? null;
}

if (Object.keys(sizes).length > 0)
  setTimeout(() => {
    void forgetOldAssets().catch(() => undefined);
  }, 10_000);

globalThis.fetch = async (input, init) => {
  const phase = currentPhase();
  const url = requestUrl(input);
  const held = takeHeld(url, input, init);
  if (held) return counted(await held, url, phase);
  if (buildAsset(url, input, init)) return keptFetch(url, phase, input, init);
  return counted(await plainFetch(input, init), url, phase);
};

async function saveQueued(href: string): Promise<void> {
  const kept = await assetStore();
  if (!kept || transfers.has(href)) return;
  if (await kept.match(href).catch(() => undefined)) return;
  const { transfer, served } = begin(href, kept, true, (signal) =>
    plainFetch(href, { priority: "low", signal }),
  );
  served.catch(() => undefined);
  if ((await transfer.stored) || transfer.dropped) return;
  const failed = (failures.get(href) ?? 0) + 1;
  failures.set(href, failed);
  if (failed < laneTries && !queue.includes(href)) queue.push(href);
}

function pump(): void {
  while (!held && lanes < laneCount) {
    const href = queue.shift();
    if (!href) return;
    lanes += 1;
    void saveQueued(href).finally(() => {
      lanes -= 1;
      pump();
    });
  }
}

function storable(urls: string[]): string[] {
  return [...new Set(urls.map(hrefOf))].filter(
    (href) => sizes[new URL(href).pathname] !== undefined,
  );
}

export function fetchAhead(urls: string[]): void {
  void assetStore().then(async (kept) => {
    if (!kept) return;
    for (const href of storable(urls)) {
      if (transfers.has(href)) continue;
      if (await kept.match(href).catch(() => undefined)) continue;
      if (transfers.has(href)) continue;
      begin(href, kept, true, () => plainFetch(href)).served.catch(
        () => undefined,
      );
    }
  });
}

export function warm(urls: string[], first = false): void {
  const wanted = storable(urls);
  queue = [...new Set(first ? [...wanted, ...queue] : [...queue, ...wanted])];
  pump();
}

export function demand(urls: string[]): void {
  const wanted = new Set(storable(urls));
  held = true;
  const dropped: string[] = [];
  for (const [href, transfer] of transfers)
    if (
      transfer.background &&
      transfer.followers.size === 0 &&
      !wanted.has(href)
    ) {
      transfer.dropped = true;
      transfer.stop();
      dropped.push(href);
    }
  queue = [...new Set([...dropped, ...queue])];
}

export function settle(): void {
  held = false;
  pump();
}

export function downloadsFromNow(): () => number {
  const meter: Meter = { paths: new Set(), expected: 0, received: 0 };
  meters.add(new WeakRef(meter));
  return () => (meter.expected > 0 ? meter.received / meter.expected : 0);
}

export function claimDownloads(urls: string[]): void {
  const phase = currentPhase();
  expectDownloads(urls);
  void assetStore().then(async (kept) => {
    const saved = new Set(
      ((await kept?.keys().catch(() => [])) ?? []).map((each) => each.url),
    );
    for (const href of storable(urls)) {
      const url = new URL(href);
      const running = transfers.get(href);
      if (!running && !saved.has(href)) continue;
      if (!firstRead(phase, url.pathname)) continue;
      if (running) void followed(url, running, phase);
      else
        credit(
          phase,
          url.pathname,
          (sizes[url.pathname] ?? 0) * wireShare(url.pathname),
        );
    }
  });
}

export function expectDownloads(urls: string[]): void {
  const phase = currentPhase();
  phase.plans += 1;
  for (const url of urls) {
    const path = new URL(url, location.href).pathname;
    const size = sizes[path];
    if (size !== undefined) expect(phase, path, size * wireShare(path));
  }
}
