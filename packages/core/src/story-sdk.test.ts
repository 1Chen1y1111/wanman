import { describe, expect, it, vi } from 'vitest';
import { createStorySdk } from './story-sdk.js';
import type { StoryApiClient } from './story-api.js';
import type { StoryRuntimeClient } from './story-runtime.js';
import type { StoryDetailRecord, StoryRecord } from './types.js';

const STORY: StoryRecord = {
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
};

const DETAIL: StoryDetailRecord = {
  ...STORY,
  status: 'running',
  sandbox_id: 'box-1',
  run_id: 'run-1',
  started_at: 1,
  artifacts: [],
  tasks: [],
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
};

function createMockStoryApi(): StoryApiClient {
  return {
    createStory: vi.fn().mockResolvedValue(STORY),
    listStories: vi.fn().mockResolvedValue([]),
    getStory: vi.fn().mockResolvedValue(DETAIL),
    getCurrentRun: vi.fn().mockResolvedValue(DETAIL.current_run),
    startStory: vi.fn().mockResolvedValue({
      status: 'running',
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
      },
    }),
    pauseStory: vi.fn().mockResolvedValue({
      status: 'paused',
      current_run: {
        id: 'run-1',
        story_id: 'story-1',
        status: 'paused',
        sandbox_id: 'box-1',
        sandbox_url: null,
        started_at: 1,
        completed_at: null,
        created_at: 1,
        updated_at: 3,
      },
    }),
    resumeStory: vi.fn().mockResolvedValue({
      status: 'running',
      current_run: {
        id: 'run-1',
        story_id: 'story-1',
        status: 'running',
        sandbox_id: 'box-1',
        sandbox_url: null,
        started_at: 1,
        completed_at: null,
        created_at: 1,
        updated_at: 4,
      },
    }),
    stopStory: vi.fn().mockResolvedValue({
      status: 'completed',
      current_run: {
        id: 'run-1',
        story_id: 'story-1',
        status: 'completed',
        sandbox_id: 'box-1',
        sandbox_url: null,
        started_at: 1,
        completed_at: 5,
        created_at: 1,
        updated_at: 5,
      },
    }),
    sendThreadMessage: vi.fn().mockResolvedValue({
      thread: {
        id: 42,
        story_id: 'story-1',
        from: 'human',
        to: 'ceo',
        message_type: 'message',
        priority: 'steer',
        text: 'Need a tighter plan',
        payload: 'Need a tighter plan',
        created_at: 5,
      },
      delivered: true,
    }),
    deleteStory: vi.fn().mockResolvedValue({ status: 'deleted' }),
    streamStoryPath: vi.fn().mockReturnValue('/api/stories/story-1/stream'),
  };
}

function createMockStoryRuntime(): StoryRuntimeClient {
  return {
    api: createMockStoryApi(),
    loadSession: vi.fn().mockResolvedValue({
      story: DETAIL,
      artifacts: DETAIL.artifacts,
      tasks: DETAIL.tasks,
      loading: false,
    }),
    streamSession: vi.fn(),
    watchSession: vi.fn(),
  };
}

describe('story sdk', () => {
  it('creates and starts a story through one shared SDK call', async () => {
    const api = createMockStoryApi();
    const runtime = createMockStoryRuntime();
    const sdk = createStorySdk({ api, runtime });

    const result = await sdk.createAndStartStory({
      name: 'Launch',
      goal: 'Ship it',
      mode: 'byos',
      provider: 'claude',
    });

    expect(api.createStory).toHaveBeenCalledWith({
      name: 'Launch',
      goal: 'Ship it',
      mode: 'byos',
      provider: 'claude',
    });
    expect(api.startStory).toHaveBeenCalledWith('story-1');
    expect(result.story.status).toBe('running');
    expect(result.story.current_run?.id).toBe('run-1');
  });

  it('applies control responses back onto the current story view', async () => {
    const api = createMockStoryApi();
    const runtime = createMockStoryRuntime();
    const sdk = createStorySdk({ api, runtime });

    const result = await sdk.pauseStory('story-1', DETAIL);

    expect(api.pauseStory).toHaveBeenCalledWith('story-1');
    expect(result.response.status).toBe('paused');
    expect(result.story?.status).toBe('paused');
    expect(result.story?.current_run?.status).toBe('paused');
  });

  it('delegates session loading and watching to the shared runtime client', async () => {
    const api = createMockStoryApi();
    const runtime = createMockStoryRuntime();
    const sdk = createStorySdk({ api, runtime });

    const state = await sdk.loadSession('story-1');

    expect(runtime.loadSession).toHaveBeenCalledWith('story-1', undefined);
    expect(state.story.id).toBe('story-1');
  });

  it('sends human thread messages through the shared story api client', async () => {
    const api = createMockStoryApi();
    const runtime = createMockStoryRuntime();
    const sdk = createStorySdk({ api, runtime });

    const result = await sdk.sendThreadMessage('story-1', {
      text: 'Need a tighter plan',
      priority: 'steer',
      message_type: 'decision',
    });

    expect(api.sendThreadMessage).toHaveBeenCalledWith('story-1', {
      text: 'Need a tighter plan',
      priority: 'steer',
      message_type: 'decision',
    });
    expect(result.delivered).toBe(true);
    expect(result.thread.to).toBe('ceo');
  });
});
