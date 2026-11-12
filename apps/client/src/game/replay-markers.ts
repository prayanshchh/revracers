export const eventLead = 3;

export type MarkerKind =
  "lap" | "gain" | "loss" | "incident" | "pit" | "fastest";

export interface Marker {
  time: number;
  kind: MarkerKind;
  label: string;
}

export interface Footage {
  start: number;
  end: number;
}

export function inFootage(markers: Marker[], footage: Footage): Marker[] {
  return markers.filter(
    (m) => m.time >= footage.start && m.time <= footage.end,
  );
}

export function eventAfter(
  markers: Marker[],
  time: number,
  step: 1 | -1,
  footage: Footage,
): Marker | null {
  const ordered = inFootage(markers, footage).sort((a, b) => a.time - b.time);
  if (step > 0)
    return ordered.find((m) => m.time - eventLead > time + 0.25) ?? null;
  return (
    ordered.reverse().find((m) => m.time - eventLead < time - 0.25) ?? null
  );
}
