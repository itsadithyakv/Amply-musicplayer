/**
 * Runs the full mix engine off the main thread. Protocol: `{ id, input }` in, `{ id, output }` or
 * `{ id, error }` out (see services/mixEngineClient.ts).
 */
import { generateMixes, type MixEngineInput } from '@/services/mixEngine';

export interface MixEngineWorkerRequest {
  id: number;
  input: MixEngineInput;
}

export type MixEngineWorkerResponse =
  | { id: number; output: ReturnType<typeof generateMixes> }
  | { id: number; error: string };

self.onmessage = (event: MessageEvent<MixEngineWorkerRequest>) => {
  const { id, input } = event.data;
  let response: MixEngineWorkerResponse;
  try {
    response = { id, output: generateMixes(input) };
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
