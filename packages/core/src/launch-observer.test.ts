import { describe, expect, it, vi } from 'vitest';
import { observeLaunch } from './launch-observer.js';

describe('observeLaunch', () => {
  it('loads once and then streams until a launch reaches a terminal state', async () => {
    const loadLaunch = vi
      .fn()
      .mockResolvedValue({
        id: 'launch-1',
        status: 'queued',
        timeline: [],
      });
    const streamLaunch = vi.fn(async function* () {
      yield {
        kind: 'message',
        launch: {
          id: 'launch-1',
          status: 'running',
          timeline: [{ id: 1 }],
        },
      };
      yield {
        kind: 'message',
        launch: {
          id: 'launch-1',
          status: 'completed',
          timeline: [{ id: 1 }, { id: 2 }],
        },
      };
      return {
        id: 'launch-1',
        status: 'completed',
        timeline: [{ id: 1 }, { id: 2 }],
      };
    });

    const snapshots: string[] = [];
    for await (const event of observeLaunch({ loadLaunch, streamLaunch } as any, 'launch-1', null, {
      pollIntervalMs: 0,
      retryDelayMs: 0,
    })) {
      snapshots.push(event.launch.status);
    }

    expect(snapshots).toEqual(['queued', 'running', 'completed']);
    expect(loadLaunch).toHaveBeenCalledTimes(1);
    expect(streamLaunch).toHaveBeenCalledTimes(1);
  });

  it('retries after transient stream errors once it has a current snapshot', async () => {
    const loadLaunch = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'launch-1',
        status: 'running',
        timeline: [],
      })
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({
        id: 'launch-1',
        status: 'failed',
        timeline: [{ id: 1 }],
      });
    const streamLaunch = vi
      .fn()
      .mockImplementationOnce(async function* () {
        throw new Error('temporary');
      })
      .mockImplementationOnce(async function* () {
        return {
          id: 'launch-1',
          status: 'failed',
          timeline: [{ id: 1 }],
        };
      });

    const snapshots: string[] = [];
    for await (const event of observeLaunch({ loadLaunch, streamLaunch } as any, 'launch-1', null, {
      pollIntervalMs: 0,
      retryDelayMs: 0,
    })) {
      snapshots.push(event.launch.status);
    }

    expect(snapshots).toEqual(['running', 'failed']);
  });
});
