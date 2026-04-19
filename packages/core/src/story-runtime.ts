import type { StoryApiClient } from './story-api.js';
import {
  applyStoryStreamMessage,
  hydrateStorySessionState,
  parseStoryStreamChunk,
  shouldStreamStoryView,
  type StorySessionStateRecord,
} from './story-session.js';
import type {
  StoryArtifactRecord,
  StoryDetailRecord,
  StoryStreamMessageRecord,
  StoryTaskRecord,
} from './types.js';

export interface StoryRuntimeStreamRequestRecord {
  path: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface StoryRuntimeStreamResponseRecord {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

export type StoryRuntimeStreamTransport = (
  request: StoryRuntimeStreamRequestRecord,
) => Promise<StoryRuntimeStreamResponseRecord>;

export interface StoryRuntimeWatchOptionsRecord {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface StoryRuntimeEventRecord<
  TStory extends StoryDetailRecord | null = StoryDetailRecord | null,
  TArtifact extends { id: string } = StoryArtifactRecord,
  TTask extends { id: string } = StoryTaskRecord,
> {
  kind: 'snapshot' | 'message';
  state: StorySessionStateRecord<TStory, TArtifact, TTask>;
  message?: StoryStreamMessageRecord;
}

export interface StoryRuntimeClient {
  api: StoryApiClient;
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
  watchSession<
    TStory extends StoryDetailRecord = StoryDetailRecord,
    TArtifact extends { id: string } = StoryArtifactRecord,
    TTask extends { id: string } = StoryTaskRecord,
  >(
    storyId: string,
    current?: StorySessionStateRecord<TStory | null, TArtifact, TTask>,
    options?: StoryRuntimeWatchOptionsRecord,
  ): AsyncGenerator<StoryRuntimeEventRecord<TStory, TArtifact, TTask>, StorySessionStateRecord<TStory, TArtifact, TTask>>;
}

export function createInitialStorySessionState<
  TStory extends StoryDetailRecord | null = StoryDetailRecord | null,
  TArtifact extends { id: string } = StoryArtifactRecord,
  TTask extends { id: string } = StoryTaskRecord,
>(): StorySessionStateRecord<TStory, TArtifact, TTask> {
  return {
    story: null as TStory,
    artifacts: [],
    tasks: [],
    loading: true,
  };
}

export async function loadStorySession<
  TStory extends StoryDetailRecord = StoryDetailRecord,
  TArtifact extends { id: string } = StoryArtifactRecord,
  TTask extends { id: string } = StoryTaskRecord,
>(
  client: Pick<StoryApiClient, 'getStory'>,
  storyId: string,
  current: StorySessionStateRecord<TStory | null, TArtifact, TTask> = createInitialStorySessionState<
    TStory | null,
    TArtifact,
    TTask
  >(),
): Promise<StorySessionStateRecord<TStory, TArtifact, TTask>> {
  const detail = await client.getStory(storyId);
  return hydrateStorySessionState(
    current,
    detail as TStory & { artifacts?: TArtifact[]; tasks?: TTask[] },
  );
}

export async function* streamStorySession<
  TStory extends StoryDetailRecord,
  TArtifact extends { id: string } = StoryArtifactRecord,
  TTask extends { id: string } = StoryTaskRecord,
>(
  client: Pick<StoryApiClient, 'streamStoryPath'>,
  openStream: StoryRuntimeStreamTransport,
  storyId: string,
  current: StorySessionStateRecord<TStory, TArtifact, TTask>,
  options: StoryRuntimeWatchOptionsRecord = {},
): AsyncGenerator<StoryRuntimeEventRecord<TStory, TArtifact, TTask>, StorySessionStateRecord<TStory, TArtifact, TTask>> {
  let state = current;
  if (!shouldStreamStoryView(state.story)) return state;
  if (options.signal?.aborted) return state;

  const response = await openStream({
    path: client.streamStoryPath(storyId),
    headers: {
      Accept: 'text/event-stream',
      ...options.headers,
    },
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Story stream ${response.status}: ${text}`);
  }

  if (!response.body) {
    throw new Error('Story stream response did not include a readable body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      const parsed = parseStoryStreamChunk(
        buffer,
        done ? `${decoder.decode()}\n\n` : decoder.decode(value, { stream: true }),
      );
      buffer = parsed.buffer;

      for (const message of parsed.messages) {
        state = applyStoryStreamMessage(state, message);
        yield { kind: 'message', state, message };

        if (!shouldStreamStoryView(state.story)) {
          await reader.cancel().catch(() => {});
          return state;
        }

        if (options.signal?.aborted) {
          await reader.cancel().catch(() => {});
          return state;
        }
      }

      if (done || options.signal?.aborted) return state;
    }
  } catch (error) {
    if (isAbortError(error, options.signal)) return state;
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function* watchStorySession<
  TStory extends StoryDetailRecord = StoryDetailRecord,
  TArtifact extends { id: string } = StoryArtifactRecord,
  TTask extends { id: string } = StoryTaskRecord,
>(
  client: Pick<StoryApiClient, 'getStory' | 'streamStoryPath'>,
  openStream: StoryRuntimeStreamTransport,
  storyId: string,
  current: StorySessionStateRecord<TStory | null, TArtifact, TTask> = createInitialStorySessionState<
    TStory | null,
    TArtifact,
    TTask
  >(),
  options: StoryRuntimeWatchOptionsRecord = {},
): AsyncGenerator<StoryRuntimeEventRecord<TStory, TArtifact, TTask>, StorySessionStateRecord<TStory, TArtifact, TTask>> {
  const state = await loadStorySession(client, storyId, current);
  yield { kind: 'snapshot', state };

  if (!shouldStreamStoryView(state.story)) return state;

  return yield* streamStorySession(client, openStream, storyId, state, options);
}

export function createStoryRuntimeClient(args: {
  api: StoryApiClient;
  openStream: StoryRuntimeStreamTransport;
}): StoryRuntimeClient {
  return {
    api: args.api,
    loadSession(storyId, current) {
      return loadStorySession(args.api, storyId, current);
    },
    streamSession(storyId, current, options) {
      return streamStorySession(args.api, args.openStream, storyId, current, options);
    },
    watchSession(storyId, current, options) {
      return watchStorySession(args.api, args.openStream, storyId, current, options);
    },
  };
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError');
}
