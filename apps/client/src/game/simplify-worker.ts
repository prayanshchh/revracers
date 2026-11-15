import { simplifyAllHere, type SimplifyJob } from "./simplify-jobs.ts";

interface Request {
  id: number;
  jobs: SimplifyJob[];
}

interface Scope {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as Scope;

scope.onmessage = (event) => {
  const { id, jobs } = event.data;
  simplifyAllHere(jobs).then(
    (indices) => {
      scope.postMessage(
        { id, indices },
        indices.map((each) => each.buffer),
      );
    },
    () => {
      scope.postMessage({ id, indices: null });
    },
  );
};
