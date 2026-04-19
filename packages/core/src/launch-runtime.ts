import type { LaunchApiClient } from './launch-api.js';
import type { LaunchDetailRecord, LaunchStreamMessageRecord } from './types.js';
import { shouldStreamLaunch } from './launch.js';

export interface LaunchRuntimeStreamRequestRecord {
  path: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface LaunchRuntimeStreamResponseRecord {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

export type LaunchRuntimeStreamTransport = (
  request: LaunchRuntimeStreamRequestRecord,
) => Promise<LaunchRuntimeStreamResponseRecord>;

export interface LaunchRuntimeWatchOptionsRecord {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface LaunchRuntimeEventRecord<TLaunch extends LaunchDetailRecord = LaunchDetailRecord> {
  kind: 'snapshot' | 'message';
  launch: TLaunch;
  message?: LaunchStreamMessageRecord;
}

export interface LaunchRuntimeClient {
  api: LaunchApiClient;
  loadLaunch<TLaunch extends LaunchDetailRecord = LaunchDetailRecord>(launchId: string): Promise<TLaunch>;
  streamLaunch<TLaunch extends LaunchDetailRecord = LaunchDetailRecord>(
    launchId: string,
    current: TLaunch,
    options?: LaunchRuntimeWatchOptionsRecord,
  ): AsyncGenerator<LaunchRuntimeEventRecord<TLaunch>, TLaunch>;
  watchLaunch<TLaunch extends LaunchDetailRecord = LaunchDetailRecord>(
    launchId: string,
    current?: TLaunch | null,
    options?: LaunchRuntimeWatchOptionsRecord,
  ): AsyncGenerator<LaunchRuntimeEventRecord<TLaunch>, TLaunch>;
}

export async function loadLaunchDetail<TLaunch extends LaunchDetailRecord = LaunchDetailRecord>(
  client: Pick<LaunchApiClient, 'getLaunch'>,
  launchId: string,
): Promise<TLaunch> {
  return client.getLaunch(launchId) as Promise<TLaunch>;
}

export async function* streamLaunchDetail<TLaunch extends LaunchDetailRecord = LaunchDetailRecord>(
  client: Pick<LaunchApiClient, 'streamLaunchPath'>,
  openStream: LaunchRuntimeStreamTransport,
  launchId: string,
  current: TLaunch,
  options: LaunchRuntimeWatchOptionsRecord = {},
): AsyncGenerator<LaunchRuntimeEventRecord<TLaunch>, TLaunch> {
  let launch = current;
  if (!shouldStreamLaunch(launch)) return launch;
  if (options.signal?.aborted) return launch;

  const response = await openStream({
    path: client.streamLaunchPath(launchId),
    headers: {
      Accept: 'text/event-stream',
      ...options.headers,
    },
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Launch stream ${response.status}: ${text}`);
  }

  if (!response.body) {
    throw new Error('Launch stream response did not include a readable body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      const parsed = parseLaunchStreamChunk(
        buffer,
        done ? `${decoder.decode()}\n\n` : decoder.decode(value, { stream: true }),
      );
      buffer = parsed.buffer;

      for (const message of parsed.messages) {
        if (message.eventType === 'launch') {
          launch = message.data as TLaunch;
          yield { kind: 'message', launch, message };

          if (!shouldStreamLaunch(launch)) {
            await reader.cancel().catch(() => {});
            return launch;
          }
        }

        if (options.signal?.aborted) {
          await reader.cancel().catch(() => {});
          return launch;
        }
      }

      if (done || options.signal?.aborted) return launch;
    }
  } catch (error) {
    if (isAbortError(error, options.signal)) return launch;
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function* watchLaunchDetail<TLaunch extends LaunchDetailRecord = LaunchDetailRecord>(
  client: Pick<LaunchApiClient, 'getLaunch' | 'streamLaunchPath'>,
  openStream: LaunchRuntimeStreamTransport,
  launchId: string,
  current: TLaunch | null = null,
  options: LaunchRuntimeWatchOptionsRecord = {},
): AsyncGenerator<LaunchRuntimeEventRecord<TLaunch>, TLaunch> {
  const launch = current ?? await loadLaunchDetail<TLaunch>(client, launchId);
  yield { kind: 'snapshot', launch };

  if (!shouldStreamLaunch(launch)) return launch;

  return yield* streamLaunchDetail(client, openStream, launchId, launch, options);
}

export function parseLaunchStreamChunk(
  buffer: string,
  chunk: string,
): { buffer: string; messages: LaunchStreamMessageRecord[] } {
  const chunks = (buffer + chunk).split('\n\n');
  const nextBuffer = chunks.pop() ?? '';
  const messages: LaunchStreamMessageRecord[] = [];

  for (const rawMessage of chunks) {
    let eventType = '';
    let eventData = '';

    for (const line of rawMessage.split('\n')) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7);
      } else if (line.startsWith('data: ')) {
        eventData = line.slice(6);
      }
    }

    if (!eventData) continue;

    try {
      messages.push({ eventType, data: JSON.parse(eventData) });
    } catch {
      // Ignore malformed payloads and continue parsing the stream.
    }
  }

  return { buffer: nextBuffer, messages };
}

export function createLaunchRuntimeClient(args: {
  api: LaunchApiClient;
  openStream: LaunchRuntimeStreamTransport;
}): LaunchRuntimeClient {
  return {
    api: args.api,
    loadLaunch(launchId) {
      return loadLaunchDetail(args.api, launchId);
    },
    streamLaunch(launchId, current, options) {
      return streamLaunchDetail(args.api, args.openStream, launchId, current, options);
    },
    watchLaunch(launchId, current, options) {
      return watchLaunchDetail(args.api, args.openStream, launchId, current, options);
    },
  };
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError');
}
