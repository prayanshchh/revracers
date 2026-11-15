interface Held {
  value: Promise<unknown>;
  drop: (value: never) => void;
}

const held = new Map<string, Held>();

export function prime<T>(
  key: string,
  load: () => Promise<T>,
  drop: (value: T) => void,
): void {
  if (held.has(key)) return;
  const value = load();
  value.catch(() => undefined);
  held.set(key, { value, drop: drop });
}

export function primed<T>(key: string, load: () => Promise<T>): Promise<T> {
  const ready = held.get(key);
  if (!ready) return load();
  held.delete(key);
  return (ready.value as Promise<T>).catch(() => load());
}

export function forgetPrimed(keep: (key: string) => boolean): void {
  for (const [key, { value, drop }] of held) {
    if (keep(key)) continue;
    held.delete(key);
    void value.then(drop as (value: unknown) => void, () => undefined);
  }
}
