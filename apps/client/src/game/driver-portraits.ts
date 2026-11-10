import type { GridEntry } from "./teams.ts";

const files = import.meta.glob<string>(
  "../../../../content/cars/*/portrait-*.webp",
  { eager: true, query: "?url", import: "default" },
);

function portraitUrl(entry: GridEntry): string {
  const seat = entry.player ? "player" : String(entry.seat);
  return (
    files[`../../../../content/cars/${entry.team.id}/portrait-${seat}.webp`] ??
    ""
  );
}

export async function loadPortraits(
  grid: GridEntry[],
): Promise<HTMLImageElement[]> {
  return Promise.all(
    grid.map(async (entry) => {
      const image = new Image();
      image.decoding = "async";
      image.alt = "";
      image.src = portraitUrl(entry);
      await image.decode().catch(() => undefined);
      return image;
    }),
  );
}
