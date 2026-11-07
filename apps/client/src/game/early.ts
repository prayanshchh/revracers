const early = new Map<string, Promise<Response>>();
const nativeFetch = globalThis.fetch.bind(globalThis);

async function buffered(url: string): Promise<Response> {
  const response = await nativeFetch(url);
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function holdEarly(urls: string[]): Promise<unknown>[] {
  const pending: Promise<unknown>[] = [];
  for (const url of urls) {
    const href = new URL(url, location.href).href;
    if (early.has(href)) continue;
    const held = buffered(href);
    held.catch(() => undefined);
    early.set(href, held);
    pending.push(held.catch(() => undefined));
  }
  return pending;
}

export function fetchEarly(...waves: string[][]): void {
  void waves.reduce<Promise<unknown>>(
    (previous, wave) => previous.then(() => Promise.all(holdEarly(wave))),
    Promise.resolve(),
  );
}

export function takeEarly(href: string): Promise<Response> | null {
  const held = early.get(href);
  if (!held) return null;
  early.delete(href);
  return held;
}

export function dropEarly(): void {
  early.clear();
}
