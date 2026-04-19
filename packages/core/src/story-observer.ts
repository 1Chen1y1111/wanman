import { shouldPollStoryView, shouldStreamStoryView, type StorySessionStateRecord } from './story-session.js';
import {
  createInitialStorySessionState,
  type StoryRuntimeEventRecord,
  type StoryRuntimeWatchOptionsRecord,
} from './story-runtime.js';
import type {
  StoryArtifactRecord,
  StoryDetailRecord,
  StoryTaskRecord,
} from './types.js';

export interface StoryObserveSessionOptionsRecord extends StoryRuntimeWatchOptionsRecord {
  pollIntervalMs?: number;
  retryDelayMs?: number;
}

export interface StoryObserveSessionClient {
  loadSession<
    TStory extends StoryDetailRecord = StoryDetailRecord,
    TArtifact extends { id: string } = StoryArtifactRecord,
    TTask extends { id: string } = StoryTaskRecord,
  >(
    storyId: string,
    current?: StorySessionStateRecord<TStory | null, TArtifact, TTask>,
  ): Promise<StorySessionStateRecord<TStory, TArtifact, TTask>>;
  streamSession<
    TStory extends StoryDetailRecord,
    TArtifact extends { id: string } = StoryArtifactRecord,
    TTask extends { id: string } = StoryTaskRecord,
  >(
    storyId: string,
    current: StorySessionStateRecord<TStory, TArtifact, TTask>,
    options?: StoryRuntimeWatchOptionsRecord,
  ): AsyncGenerator<StoryRuntimeEventRecord<TStory, TArtifact, TTask>, StorySessionStateRecord<TStory, TArtifact, TTask>>;
}

export async function* observeStorySession<
  TStory extends StoryDetailRecord = StoryDetailRecord,
  TArtifact extends { id: string } = StoryArtifactRecord,
  TTask extends { id: string } = StoryTaskRecord,
>(
  client: StoryObserveSessionClient,
  storyId: string,
  current: StorySessionStateRecord<TStory | null, TArtifact, TTask> = createInitialStorySessionState<
    TStory | null,
    TArtifact,
    TTask
  >(),
  options: StoryObserveSessionOptionsRecord = {},
): AsyncGenerator<StoryRuntimeEventRecord<TStory, TArtifact, TTask>, StorySessionStateRecord<TStory, TArtifact, TTask>> {
  let state = current as StorySessionStateRecord<TStory | null, TArtifact, TTask>;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const retryDelayMs = options.retryDelayMs ?? 1_000;

  while (true) {
    if (options.signal?.aborted) return state as StorySessionStateRecord<TStory, TArtifact, TTask>;

    let loadedState: StorySessionStateRecord<TStory, TArtifact, TTask>;
    try {
      loadedState = await client.loadSession(storyId, state) as StorySessionStateRecord<TStory, TArtifact, TTask>;
      state = loadedState;
    } catch (error) {
      if (isAbortError(error, options.signal)) return state as StorySessionStateRecord<TStory, TArtifact, TTask>;
      if (!state.story) throw error;
      await sleep(retryDelayMs, options.signal);
      continue;
    }

    yield { kind: 'snapshot', state: loadedState };

    if (shouldPollStoryView(loadedState.story)) {
      await sleep(pollIntervalMs, options.signal);
      continue;
    }

    if (!shouldStreamStoryView(loadedState.story)) {
      return loadedState;
    }

    try {
      const iterator = client.streamSession(storyId, loadedState, options);

      while (true) {
        const step = await iterator.next();
        if (step.done) {
          state = step.value as StorySessionStateRecord<TStory, TArtifact, TTask>;
          break;
        }
        state = step.value.state as StorySessionStateRecord<TStory, TArtifact, TTask>;
        yield step.value as StoryRuntimeEventRecord<TStory, TArtifact, TTask>;
      }
    } catch (error) {
      if (isAbortError(error, options.signal)) return state as StorySessionStateRecord<TStory, TArtifact, TTask>;
      await sleep(retryDelayMs, options.signal);
      continue;
    }

    if (shouldStreamStoryView(state.story)) {
      await sleep(retryDelayMs, options.signal);
      continue;
    }

    return state as StorySessionStateRecord<TStory, TArtifact, TTask>;
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
