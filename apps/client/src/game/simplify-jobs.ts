import { MeshoptSimplifier } from "meshoptimizer/simplifier";

export interface SimplifyJob {
  indices: Uint32Array;
  positions: Float32Array;
  error: number;
}

export type Simplify = (jobs: SimplifyJob[]) => Promise<Uint32Array[]>;

function simplifyHere(job: SimplifyJob): Uint32Array {
  const [indices] = MeshoptSimplifier.simplify(
    job.indices,
    job.positions,
    3,
    0,
    job.error,
    ["ErrorAbsolute"],
  );
  return indices;
}

export async function simplifyAllHere(
  jobs: SimplifyJob[],
): Promise<Uint32Array[]> {
  await MeshoptSimplifier.ready;
  return jobs.map(simplifyHere);
}
