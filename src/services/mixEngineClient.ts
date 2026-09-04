/**
 * Main-thread client for the mix-engine worker. One shared worker instance, request ids so
 * concurrent runs cannot cross, and a synchronous in-process fallback whenever `Worker` is
 * unavailable (tests, degraded webviews) or the worker fails.
 */
import { generateMixes, type MixEngineInput, type MixEngineOutput } from '@/services/mixEngine';
import { recordPerfEvent } from '@/services/perfDiagnostics';
import type { MixEngineWorkerRequest, MixEngineWorkerResponse } from '@/workers/mixEngine.worker';

type Pending = {
  resolve: (output: MixEngineOutput) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<number, Pending>();

const failAll = (error: Error): void => {
  const entries = [...pending.values()];
  pending.clear();
  for (const entry of entries) {
    entry.reject(error);
  }
};

const disposeWorker = (): void => {
  worker?.terminate();
  worker = null;
};

const getWorker = (): Worker => {
  if (worker) {
    return worker;
  }
  const instance = new Worker(new URL('../workers/mixEngine.worker.ts', import.meta.url), { type: 'module' });
  instance.onmessage = (event: MessageEvent<MixEngineWorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }
    pending.delete(message.id);
    if ('error' in message) {
      entry.reject(new Error(message.error));
      return;
    }
    entry.resolve(message.output);
  };
  instance.onerror = (event) => {
    const error = new Error(event.message || 'mix engine worker failed');
    recordPerfEvent('playlist.worker.failed', { error: error.message });
    disposeWorker();
    failAll(error);
  };
  worker = instance;
  return instance;
};

const runInWorker = (input: MixEngineInput): Promise<MixEngineOutput> =>
  new Promise<MixEngineOutput>((resolve, reject) => {
    const id = (nextRequestId += 1);
    pending.set(id, { resolve, reject });
    const request: MixEngineWorkerRequest = { id, input };
    try {
      getWorker().postMessage(request);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });

/** Full engine run; off-thread when possible, in-process otherwise. */
export const runMixEngine = async (input: MixEngineInput): Promise<MixEngineOutput> => {
  if (typeof Worker === 'undefined') {
    return generateMixes(input);
  }
  try {
    return await runInWorker(input);
  } catch (error) {
    recordPerfEvent('playlist.worker.fallback', { error: error instanceof Error ? error.message : String(error) });
    return generateMixes(input);
  }
};
