export function hostedPath(
  input: string,
  site: string,
  server: string,
): string {
  if (!input.startsWith("/") || input.startsWith("//")) return input;
  if (input.startsWith("/api/")) return `${server}${input}`;
  return `${site}${input.slice(1)}`;
}

export function rehomeSizes(
  sizes: Record<string, number>,
  site: string,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(sizes).map(([path, size]) => [
      `${site}${path.slice(1)}`,
      size,
    ]),
  );
}
