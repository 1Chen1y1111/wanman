import { describe, expect, it, vi } from 'vitest';
import { buildCurrentStoryRunPath, buildStoryControlPath, buildStoryStreamPath, buildStoryThreadsPath, buildStoryPath, buildStoriesPath, createStoryApiClient } from './story-api.js';

describe('story api helpers', () => {
  it('builds encoded story paths', () => {
    expect(buildStoriesPath()).toBe('/api/stories');
    expect(buildStoryPath('story/1')).toBe('/api/stories/story%2F1');
    expect(buildCurrentStoryRunPath('story/1')).toBe('/api/stories/story%2F1/runs/current');
    expect(buildStoryControlPath('story/1', 'pause')).toBe('/api/stories/story%2F1/pause');
    expect(buildStoryStreamPath('story/1')).toBe('/api/stories/story%2F1/stream');
    expect(buildStoryThreadsPath('story/1')).toBe('/api/stories/story%2F1/threads');
  });

  it('unwraps list and current-run responses through the shared client', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce({
        stories: [
          {
            id: 'story-1',
            user_id: 'user-1',
            launch_id: null,
            name: 'Launch',
            goal: 'Ship it',
            repo_url: null,
            status: 'running',
            mode: 'byos',
            provider: 'claude',
            sandbox_id: 'box-1',
            sandbox_url: null,
            run_id: 'run-1',
            config: null,
            started_at: 1,
            completed_at: null,
            created_at: 1,
            taskSummaries: [],
            artifactCount: 0,
            agentCount: 0,
            openDecisionCount: 0,
            openBlockerCount: 0,
            current_run: null,
          },
        ],
      })
      .mockResolvedValueOnce({
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
      });
    const client = createStoryApiClient(transport);

    await expect(client.listStories()).resolves.toHaveLength(1);
    await expect(client.getCurrentRun('story-1')).resolves.toMatchObject({ id: 'run-1' });
    expect(transport).toHaveBeenNthCalledWith(1, { path: '/api/stories' });
    expect(transport).toHaveBeenNthCalledWith(2, { path: '/api/stories/story-1/runs/current' });
  });

  it('sends create and control requests with the shared route contract', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        thread: {
          id: 42,
          story_id: 'story-1',
          from: 'human',
          to: 'ceo',
          message_type: 'decision',
          priority: 'steer',
          text: 'Need a tighter plan',
          payload: 'Need a tighter plan',
          created_at: 3,
        },
        delivered: true,
      })
      .mockResolvedValueOnce({ status: 'deleted' });
    const client = createStoryApiClient(transport);

    await client.createStory({
      name: 'Launch',
      goal: 'Ship it',
      mode: 'byos',
      provider: 'claude',
    });
    await client.startStory('story-1');
    await client.sendThreadMessage('story-1', {
      text: 'Need a tighter plan',
      priority: 'steer',
      message_type: 'decision',
    });
    await client.deleteStory('story-1');

    expect(transport).toHaveBeenNthCalledWith(1, {
      path: '/api/stories',
      method: 'POST',
      body: {
        name: 'Launch',
        goal: 'Ship it',
        mode: 'byos',
        provider: 'claude',
      },
    });
    expect(transport).toHaveBeenNthCalledWith(2, {
      path: '/api/stories/story-1/start',
      method: 'POST',
    });
    expect(transport).toHaveBeenNthCalledWith(3, {
      path: '/api/stories/story-1/threads',
      method: 'POST',
      body: {
        text: 'Need a tighter plan',
        priority: 'steer',
        message_type: 'decision',
      },
    });
    expect(transport).toHaveBeenNthCalledWith(4, {
      path: '/api/stories/story-1',
      method: 'DELETE',
    });
  });
});
