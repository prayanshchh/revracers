export const defaultTeam = "velza";

const files = import.meta.glob<string>(
  [
    "../../../../content/cars/*/*.{glb,jpg,png}",
    "../../../../content/cars/*/lite/*.{bin,jpg}",
  ],
  { eager: true, query: "?url", import: "default" },
);

export function liteCarFiles(team: string): string[] {
  return ["lite/car.bin", "lite/albedo.jpg", "lite/orm.jpg", "lite/bump.jpg"]
    .map((name) => carFile(team, name))
    .concat(carFile("shared", "lite/tyre.jpg"));
}

export function carFile(team: string, name: string): string {
  const url = files[`../../../../content/cars/${team}/${name}`];
  if (!url) throw new Error(`missing car file ${team}/${name}`);
  return url;
}
