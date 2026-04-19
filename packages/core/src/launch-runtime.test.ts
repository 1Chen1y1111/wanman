import { describe, expect, it } from 'vitest';
import {
  createLaunchRuntimeClient,
  parseLaunchStreamChunk,
} from './launch-runtime.js';

function createStreamResponse(bodyText: string) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(bodyText));
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    body: stream,
    async text() {
      return bodyText;
    },
  };
}

describe('launch-runtime', () => {
  it('parses launch stream chunks', () => {
    expect(parseLaunchStreamChunk('', 'event: launch\ndata: {"id":"launch-1"}\n\n')).toEqual({
      buffer: '',
      messages: [{ eventType: 'launch', data: { id: 'launch-1' } }],
    });
  });

  it('loads and streams launch detail updates', async () => {
    const api = {
      getLaunch: async () => ({
        id: 'launch-1',
        status: 'queued',
        timeline: [],
      }),
      streamLaunchPath: () => '/api/launches/launch-1/stream',
    } as any;

    const runtime = createLaunchRuntimeClient({
      api,
      openStream: async () => createStreamResponse([
        'event: launch',
        'data: {"id":"launch-1","status":"running","timeline":[{"id":1}]}',
        '',
        'event: launch',
        'data: {"id":"launch-1","status":"completed","timeline":[{"id":1},{"id":2}]}',
        '',
      ].join('\n')),
    });

    await expect(runtime.loadLaunch('launch-1')).resolves.toEqual({
      id: 'launch-1',
      status: 'queued',
      timeline: [],
    });

    const statuses: string[] = [];
    for await (const event of runtime.watchLaunch('launch-1')) {
      statuses.push(event.launch.status);
    }

    expect(statuses).toEqual(['queued', 'running', 'completed']);
  });
});
