import { describe, expect, it } from 'vitest';
import {
  applyStoryRunControlResponse,
  applyStoryStreamMessage,
  getStoryRunStatus,
  hydrateStorySessionState,
  isStoryViewLive,
  mergeStoryRunEvent,
  mergeStreamEntityById,
  parseStoryStreamChunk,
  patchStoryRunStatus,
  shouldStreamStoryView,
} from './story-session.js';
import type { StoryDetailRecord, StoryViewRecord } from './types.js';

const STORY: StoryViewRecord = {
  id: 'story-1',
  user_id: 'user-1',
  launch_id: null,
  name: 'Launch',
  goal: 'Build a launch page',
  repo_url: null,
  status: 'pending',
  mode: 'byos',
  provider: 'codex',
  sandbox_id: null,
  sandbox_url: null,
  run_id: 'run-1',
  config: null,
  started_at: null,
  completed_at: null,
  created_at: 1,
};

describe('story session helpers', () => {
  it('prefers current_run status over the story projection status', () => {
    expect(getStoryRunStatus({
      ...STORY,
      current_run: {
        id: 'run-1',
        story_id: 'story-1',
        status: 'running',
        sandbox_id: 'box-1',
        sandbox_url: null,
        started_at: 2,
        completed_at: null,
        created_at: 2,
        updated_at: 3,
      },
    })).toBe('running');
  });

  it('patches optimistic status updates onto the current run summary', () => {
    const paused = patchStoryRunStatus({
      ...STORY,
      status: 'running',
      current_run: {
        id: 'run-1',
        story_id: 'story-1',
        status: 'running',
        sandbox_id: 'box-1',
        sandbox_url: null,
        started_at: 2,
        completed_at: null,
        created_at: 2,
        updated_at: 3,
      },
    }, 'paused');

    expect(paused?.status).toBe('paused');
    expect(paused?.current_run?.status).toBe('paused');
    expect(isStoryViewLive(paused)).toBe(true);
    expect(shouldStreamStoryView(paused)).toBe(true);
  });

  it('upgrades a summary run into a timeline-aware run when stream events arrive', () => {
    const story = mergeStoryRunEvent({
      ...STORY,
      current_run: {
        id: 'run-1',
        story_id: 'story-1',
        status: 'running',
        sandbox_id: 'box-1',
        sandbox_url: null,
        started_at: 2,
        completed_at: null,
        created_at: 2,
        updated_at: 3,
      },
    }, {
      id: 10,
      story_id: 'story-1',
      run_id: 'run-1',
      event_type: 'sandbox.ready',
      status: 'running',
      actor: 'system',
      payload: { sandbox_id: 'box-2' },
      created_at: 4,
    });

    expect(story?.sandbox_id).toBe('box-2');
    expect(story?.current_run && 'timeline' in story.current_run ? story.current_run.timeline : []).toEqual([
      {
        id: 10,
        story_id: 'story-1',
        run_id: 'run-1',
        event_type: 'sandbox.ready',
        status: 'running',
        actor: 'system',
        payload: { sandbox_id: 'box-2' },
        created_at: 4,
      },
    ]);
  });

  it('applies control responses using the returned current run summary', () => {
    const story = applyStoryRunControlResponse(STORY, {
      status: 'paused',
      current_run: {
        id: 'run-1',
        story_id: 'story-1',
        status: 'paused',
        sandbox_id: 'box-1',
        sandbox_url: null,
        started_at: 2,
        completed_at: null,
        created_at: 2,
        updated_at: 5,
      },
    });

    expect(story?.status).toBe('paused');
    expect(story?.run_id).toBe('run-1');
    expect(story?.sandbox_id).toBe('box-1');
    expect(story?.current_run?.status).toBe('paused');
  });

  it('preserves existing timeline entries when a control response only returns a run summary', () => {
    const story = applyStoryRunControlResponse({
      ...STORY,
      current_run: {
        id: 'run-1',
        story_id: 'story-1',
        status: 'running',
        sandbox_id: 'box-1',
        sandbox_url: null,
        started_at: 2,
        completed_at: null,
        created_at: 2,
        updated_at: 3,
        timeline: [{
          id: 10,
          story_id: 'story-1',
          run_id: 'run-1',
          event_type: 'status.transition',
          status: 'running',
          actor: 'system',
          payload: { from: 'pending', to: 'running' },
          created_at: 3,
        }],
      },
    }, {
      status: 'paused',
      current_run: {
        id: 'run-1',
        story_id: 'story-1',
        status: 'paused',
        sandbox_id: 'box-1',
        sandbox_url: null,
        started_at: 2,
        completed_at: null,
        created_at: 2,
        updated_at: 4,
      },
    });

    expect(story?.current_run && 'timeline' in story.current_run ? story.current_run.timeline : []).toHaveLength(1);
    expect(story?.current_run?.status).toBe('paused');
  });

  it('parses multiple SSE messages and preserves the trailing buffer', () => {
    const first = parseStoryStreamChunk(
      '',
      [
        'event: artifact',
        'data: {"id":"a1","path":"deliverables/a1.md"}',
        '',
        'event: task',
        'data: {"id":"t1","status":"todo","title":"Draft spec"}',
        '',
        'event: status',
        'data: {"status":"running"}',
      ].join('\n'),
    );

    expect(first.messages).toEqual([
      { eventType: 'artifact', data: { id: 'a1', path: 'deliverables/a1.md' } },
      { eventType: 'task', data: { id: 't1', status: 'todo', title: 'Draft spec' } },
    ]);
    expect(first.buffer).toBe('event: status\ndata: {"status":"running"}');

    const second = parseStoryStreamChunk(first.buffer, '\n\n');
    expect(second.messages).toEqual([
      { eventType: 'status', data: { status: 'running' } },
    ]);
    expect(second.buffer).toBe('');
  });

  it('hydrates and updates story session state from stream messages', () => {
    const detail: StoryDetailRecord = {
      ...STORY,
      status: 'running',
      current_run: {
        id: 'run-1',
        story_id: 'story-1',
        status: 'running',
        sandbox_id: 'box-1',
        sandbox_url: null,
        started_at: 2,
        completed_at: null,
        created_at: 2,
        updated_at: 3,
        timeline: [],
      },
      artifacts: [],
      tasks: [],
    };
    const state = hydrateStorySessionState({ story: null, artifacts: [], tasks: [], loading: true }, detail);
    const next = applyStoryStreamMessage(state, {
      eventType: 'run',
      data: {
        id: 10,
        story_id: 'story-1',
        run_id: 'run-1',
        event_type: 'status.transition',
        status: 'completed',
        actor: 'system',
        payload: { from: 'running', to: 'completed' },
        created_at: 4,
      },
    });

    expect(next.story?.status).toBe('completed');
    expect(next.story?.current_run && 'timeline' in next.story.current_run ? next.story.current_run.timeline : []).toHaveLength(1);
  });

  it('merges thread messages onto the hydrated story state', () => {
    const detail: StoryDetailRecord = {
      ...STORY,
      status: 'running',
      current_run: null,
      artifacts: [],
      tasks: [],
    };
    const state = hydrateStorySessionState({ story: null, artifacts: [], tasks: [], loading: true }, detail);
    const next = applyStoryStreamMessage(state, {
      eventType: 'thread',
      data: {
        id: 22,
        story_id: 'story-1',
        from: 'ceo',
        to: 'dev',
        message_type: 'message',
        priority: 'normal',
        text: 'Please revise the rollout plan.',
        payload: 'Please revise the rollout plan.',
        created_at: 5,
      },
    });

    expect(next.story?.threads).toEqual([
      {
        id: 22,
        story_id: 'story-1',
        from: 'ceo',
        to: 'dev',
        message_type: 'message',
        priority: 'normal',
        text: 'Please revise the rollout plan.',
        payload: 'Please revise the rollout plan.',
        created_at: 5,
      },
    ]);
  });

  it('upserts existing thread messages when stream updates resolve them', () => {
    const detail: StoryDetailRecord = {
      ...STORY,
      status: 'running',
      current_run: null,
      artifacts: [],
      tasks: [],
      threads: [{
        id: 22,
        story_id: 'story-1',
        from: 'planner',
        to: 'human',
        message_type: 'decision',
        priority: 'normal',
        text: 'Approve rollout phase 1?',
        payload: null,
        created_at: 5,
        status: 'open',
        resolved_at: null,
        resolution_thread_id: null,
      }],
    };
    const state = hydrateStorySessionState({ story: null, artifacts: [], tasks: [], loading: true }, detail);
    const next = applyStoryStreamMessage(state, {
      eventType: 'thread',
      data: {
        id: 22,
        story_id: 'story-1',
        from: 'planner',
        to: 'human',
        message_type: 'decision',
        priority: 'normal',
        text: 'Approve rollout phase 1?',
        payload: null,
        created_at: 5,
        status: 'resolved',
        resolved_at: 6,
        resolution_thread_id: 23,
      },
    });

    expect(next.story?.threads).toEqual([
      {
        id: 22,
        story_id: 'story-1',
        from: 'planner',
        to: 'human',
        message_type: 'decision',
        priority: 'normal',
        text: 'Approve rollout phase 1?',
        payload: null,
        created_at: 5,
        status: 'resolved',
        resolved_at: 6,
        resolution_thread_id: 23,
      },
    ]);
  });

  it('upserts stream entities by id', () => {
    expect(mergeStreamEntityById([{ id: 't1', status: 'todo' }], { id: 't1', status: 'done' })).toEqual([
      { id: 't1', status: 'done' },
    ]);
  });
});
