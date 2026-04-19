import { describe, expect, it, vi } from 'vitest';
import {
  createInitialStorySessionState,
  createStoryRuntimeClient,
  loadStorySession,
  streamStorySession,
} from './story-runtime.js';
import type { StoryApiClient } from './story-api.js';
import type { StoryDetailRecord } from './types.js';

const DETAIL: StoryDetailRecord = {
  id: 'story-1',
  user_id: 'user-1',
  launch_id: null,
  name: 'Launch',
  goal: 'Build a launch page',
  repo_url: null,
  status: 'running',
  mode: 'byos',
  provider: 'codex',
  sandbox_id: 'box-1',
  sandbox_url: null,
  run_id: 'run-1',
  config: null,
  started_at: 1,
  completed_at: null,
  created_at: 1,
  current_run: {
    id: 'run-1',
    story_id: 'story-1',
    status: 'running',
    sandbox_id: 'box-1',
    sandbox_url: null,
    started_at: 1,
    completed_at: null,
    created_at: 1,
    updated_at: 2,
    timeline: [],
  },
  artifacts: [],
  tasks: [],
};

function createMockStoryApi(): Pick<StoryApiClient, 'getStory' | 'streamStoryPath'> {
  return {
    getStory: vi.fn().mockResolvedValue(DETAIL),
    streamStoryPath: vi.fn().mockReturnValue('/api/stories/story-1/stream'),
  };
}

describe('story runtime helpers', () => {
  it('loads a story detail into shared session state', async () => {
    const client = createMockStoryApi();

    const state = await loadStorySession(client, 'story-1', createInitialStorySessionState());

    expect(client.getStory).toHaveBeenCalledWith('story-1');
    expect(state.story?.id).toBe('story-1');
    expect(state.loading).toBe(false);
  });

  it('streams session updates through the shared reducer', async () => {
    const client = createMockStoryApi();
    const openStream = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode([
            'event: task',
            'data: {"id":"task-1","title":"Draft spec","status":"done","assignee":"dev"}',
            '',
            'event: run',
            'data: {"id":11,"story_id":"story-1","run_id":"run-1","event_type":"status.transition","status":"completed","actor":"runtime","payload":{"from":"running","to":"completed"},"created_at":3}',
            '',
          ].join('\n')));
          controller.close();
        },
      }),
      text: vi.fn().mockResolvedValue(''),
    });
    const state = await loadStorySession(client, 'story-1', createInitialStorySessionState());

    const events = [];
    for await (const event of streamStorySession(client, openStream, 'story-1', state)) {
      events.push(event);
    }

    expect(openStream).toHaveBeenCalledWith({
      path: '/api/stories/story-1/stream',
      headers: { Accept: 'text/event-stream' },
      signal: undefined,
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.state.tasks).toEqual([
      { id: 'task-1', title: 'Draft spec', status: 'done', assignee: 'dev' },
    ]);
    expect(events[1]?.state.story?.status).toBe('completed');
  });

  it('builds a shared runtime client that yields snapshot then stream events', async () => {
    const api = {
      ...(createMockStoryApi() as StoryApiClient),
      createStory: vi.fn(),
      listStories: vi.fn(),
      getCurrentRun: vi.fn(),
      sendThreadMessage: vi.fn(),
      startStory: vi.fn(),
      pauseStory: vi.fn(),
      resumeStory: vi.fn(),
      stopStory: vi.fn(),
      deleteStory: vi.fn(),
    } satisfies StoryApiClient;
    const runtime = createStoryRuntimeClient({
      api,
      openStream: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode([
              'event: status',
              'data: {"status":"paused"}',
              '',
            ].join('\n')));
            controller.close();
          },
        }),
        text: vi.fn().mockResolvedValue(''),
      }),
    });

    const events = [];
    for await (const event of runtime.watchSession('story-1')) {
      events.push(event);
    }

    expect(events[0]?.kind).toBe('snapshot');
    expect(events[0]?.state.story?.id).toBe('story-1');
    expect(events[1]?.kind).toBe('message');
    expect(events[1]?.message).toEqual({ eventType: 'status', data: { status: 'paused' } });
    expect(events[1]?.state.story?.status).toBe('paused');
  });
});
