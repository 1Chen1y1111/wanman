import { shouldPollLaunch, shouldStreamLaunch } from './launch.js';
import type {
  LaunchRuntimeEventRecord,
  LaunchRuntimeWatchOptionsRecord,
} from './launch-runtime.js';
import type { LaunchDetailRecord } from './types.js';

export interface LaunchObserveOptionsRecord extends LaunchRuntimeWatchOptionsRecord {
  pollIntervalMs?: number;
  retryDelayMs?: number;
}

export interface LaunchObserveClient {
  loadLaunch<TLaunch extends LaunchDetailRecord = LaunchDetailRecord>(launchId: string): Promise<TLaunch>;
  streamLaunch<TLaunch extends LaunchDetailRecord = LaunchDetailRecord>(
    launchId: string,
    current: TLaunch,
    options?: LaunchRuntimeWatchOptionsRecord,
  ): AsyncGenerator<LaunchRuntimeEventRecord<TLaunch>, TLaunch>;
}

export async function* observeLaunch<
  TLaunch extends LaunchDetailRecord = LaunchDetailRecord,
>(
  client: LaunchObserveClient,
  launchId: string,
  current: TLaunch | null = null,
  options: LaunchObserveOptionsRecord = {},
): AsyncGenerator<LaunchRuntimeEventRecord<TLaunch>, TLaunch> {
  let state = current;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const retryDelayMs = options.retryDelayMs ?? 1_000;

  while (true) {
    if (options.signal?.aborted) {
      return state as TLaunch;
    }

    try {
      state = await client.loadLaunch<TLaunch>(launchId);
    } catch (error) {
      if (isAbortError(error, options.signal)) return state as TLaunch;
      if (!state) throw error;
      await sleep(retryDelayMs, options.signal);
      continue;
    }

    yield { kind: 'snapshot', launch: state };

    if (shouldPollLaunch(state) && !shouldStreamLaunch(state)) {
      await sleep(pollIntervalMs, options.signal);
      continue;
    }

    if (!shouldStreamLaunch(state)) {
      return state;
    }

    try {
      const iterator = client.streamLaunch(launchId, state, options);

      while (true) {
        const step = await iterator.next();
        if (step.done) {
          state = step.value as TLaunch;
          break;
        }

        state = step.value.launch as TLaunch;
        yield step.value as LaunchRuntimeEventRecord<TLaunch>;
      }
    } catch (error) {
      if (isAbortError(error, options.signal)) return state as TLaunch;
      await sleep(retryDelayMs, options.signal);
      continue;
    }

    if (shouldStreamLaunch(state)) {
      await sleep(retryDelayMs, options.signal);
      continue;
    }

    return state;
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError');
}

function createAbortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}
