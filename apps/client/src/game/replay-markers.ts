export const eventLead = 3;

export type MarkerKind =
  "lap" | "gain" | "loss" | "incident" | "pit" | "fastest";

export interface Marker {
  time: number;
  kind: MarkerKind;
  label: string;
}

export function eventAfter(
  markers: Marker[],
  time: number,
  step: 1 | -1,
): Marker | null {
  const ordered = [...markers].sort((a, b) => a.time - b.time);
  if (step > 0)
    return ordered.find((m) => m.time - eventLead > time + 0.25) ?? null;
  return (
    ordered.reverse().find((m) => m.time - eventLead < time - 0.25) ?? null
  );
}
