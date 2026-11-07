interface DownloadTotals {
  received: number;
  expected: number;
  plans: number;
}

let phase: DownloadTotals = { received: 0, expected: 0, plans: 0 };

export function currentPhase(): DownloadTotals {
  return phase;
}

export function startDownloadPhase(): void {
  phase = { received: 0, expected: 0, plans: 0 };
}

export function downloadTotals(): DownloadTotals {
  return { ...phase };
}
