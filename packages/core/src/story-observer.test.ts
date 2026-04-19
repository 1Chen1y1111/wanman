import { describe, expect, it, vi } from 'vitest';
import { createInitialStorySessionState } from './story-runtime.js';
import { observeStorySession } from './story-observer.js';
import type { StoryDetailRecord } from './types.js';

const PENDING_DETAIL: StoryDetailRecord = {
  id: 'story-1',
  user_id: 'user-1',
  launch_id: null,
  name: 'Launch',
  goal: 'Ship it',
  repo_url: null,
  status: 'pending',
  mode: 'byos',
  provider: 'claude',
  sandbox_id: null,
  sandbox_url: null,
  run_id: null,
  config: null,
  started_at: null,
  completed_at: null,
  created_at: 1,
  artifacts: [],
  tasks: [],
  current_run: null,
};

const RUNNING_DETAIL: StoryDetailRecord = {
  ...PENDING_DETAIL,
  status: 'running',
  sandbox_id: 'box-1',
  run_id: 'run-1',
  started_at: 2,
  current_run: {
    id: 'run-1',
    story_id: 'story-1',
    status: 'running',
    sandbox_id: 'box-1',
    sandbox_url: null,
    started_at: 2,
    completed_at: null,
    created_at: 2,
    updated_at: 2,
    timeline: [],
  },
};

describe('story observer', () => {
  it('polls until the story becomes streamable, then consumes stream events', async () => {
    const client = {
      loadSession: vi.fn()
        .mockResolvedValueOnce({
          story: PENDING_DETAIL,
          artifacts: [],
          tasks: [],
          loading: false,
        })
        .mockResolvedValueOnce({
          story: RUNNING_DETAIL,
          artifacts: [],
          tasks: [],
          loading: false,
        }),
      streamSession: vi.fn().mockImplementation(async function* () {
        yield {
          kind: 'message',
          message: { eventType: 'status', data: { status: 'completed' } },
          state: {
            story: {
              ...RUNNING_DETAIL,
              status: 'completed',
              completed_at: 3,
              current_run: {
                ...RUNNING_DETAIL.current_run!,
                status: 'completed',
                completed_at: 3,
                updated_at: 3,
              },
            },
            artifacts: [],
            tasks: [],
            loading: false,
          },
        };

        return {
          story: {
            ...RUNNING_DETAIL,
            status: 'completed',
            completed_at: 3,
            current_run: {
              ...RUNNING_DETAIL.current_run!,
              status: 'completed',
              completed_at: 3,
              updated_at: 3,
            },
          },
          artifacts: [],
          tasks: [],
          loading: false,
        };
      }),
    };

    const events = [];
    for await (const event of observeStorySession(client, 'story-1', createInitialStorySessionState(), {
      pollIntervalMs: 0,
      retryDelayMs: 0,
    })) {
      events.push(event);
    }

    expect(client.loadSession).toHaveBeenCalledTimes(2);
    expect(client.streamSession).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(3);
    expect(events[0]?.kind).toBe('snapshot');
    expect(events[0]?.state.story?.status).toBe('pending');
    expect(events[1]?.kind).toBe('snapshot');
    expect(events[1]?.state.story?.status).toBe('running');
    expect(events[2]?.kind).toBe('message');
    expect(events[2]?.state.story?.status).toBe('completed');
  });

  it('retries load errors after the first successful snapshot', async () => {
    const client = {
      loadSession: vi.fn()
        .mockResolvedValueOnce({
          story: RUNNING_DETAIL,
          artifacts: [],
          tasks: [],
          loading: false,
        })
        .mockRejectedValueOnce(new Error('temporary'))
        .mockResolvedValueOnce({
          story: {
            ...RUNNING_DETAIL,
            status: 'completed',
            completed_at: 3,
            current_run: {
              ...RUNNING_DETAIL.current_run!,
              status: 'completed',
              completed_at: 3,
              updated_at: 3,
            },
          },
          artifacts: [],
          tasks: [],
          loading: false,
        }),
      streamSession: vi.fn().mockImplementation(async function* (_storyId, current) {
        return current;
      }),
    };

    const events = [];
    for await (const event of observeStorySession(client, 'story-1', createInitialStorySessionState(), {
      pollIntervalMs: 0,
      retryDelayMs: 0,
    })) {
      events.push(event);
      if (events.length > 3) break;
    }

    expect(client.loadSession).toHaveBeenCalledTimes(3);
    expect(events[0]?.state.story?.status).toBe('running');
    expect(events[1]?.state.story?.status).toBe('completed');
  });
});
