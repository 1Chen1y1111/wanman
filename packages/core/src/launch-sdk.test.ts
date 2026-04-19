import { describe, expect, it, vi } from 'vitest';
import type { LaunchApiClient } from './launch-api.js';
import type { LaunchRuntimeClient } from './launch-runtime.js';
import { createLaunchSdk } from './launch-sdk.js';

function createApi(overrides: Partial<LaunchApiClient> = {}): LaunchApiClient {
  return {
      listLaunches: vi.fn(),
      getLaunch: vi.fn(),
      createRunLaunch: vi.fn(),
      createTakeoverLaunch: vi.fn(),
      cancelLaunch: vi.fn(),
      retryLaunch: vi.fn(),
    streamLaunchPath: vi.fn().mockReturnValue('/api/launches/launch-1/stream'),
    ...overrides,
  };
}

function createRuntime(overrides: Partial<LaunchRuntimeClient> = {}): LaunchRuntimeClient {
  return {
    api: createApi(),
    loadLaunch: vi.fn(),
    streamLaunch: vi.fn() as any,
    watchLaunch: vi.fn() as any,
    ...overrides,
  };
}

describe('createLaunchSdk', () => {
  it('delegates launch operations to the api client', async () => {
    const api = createApi({
      listLaunches: vi.fn().mockResolvedValue([{ id: 'launch-1' }]),
      createRunLaunch: vi.fn().mockResolvedValue({ id: 'launch-2' }),
      cancelLaunch: vi.fn().mockResolvedValue({ id: 'launch-cancelled', status: 'cancelled' }),
      retryLaunch: vi.fn().mockResolvedValue({ id: 'launch-3' }),
    });
    const runtime = createRuntime();
    const sdk = createLaunchSdk({ api, runtime });

    await expect(sdk.listLaunches()).resolves.toEqual([{ id: 'launch-1' }]);
    await expect(sdk.createRunLaunch({ goal: 'Ship it' })).resolves.toEqual({ id: 'launch-2' });
    await expect(sdk.cancelLaunch('launch-2')).resolves.toEqual({ id: 'launch-cancelled', status: 'cancelled' });
    await expect(sdk.retryLaunch('launch-3')).resolves.toEqual({ id: 'launch-3' });
  });

  it('observes a launch through the shared observer', async () => {
    const api = createApi({
      getLaunch: vi
        .fn()
        .mockResolvedValueOnce({ id: 'launch-1', status: 'queued', timeline: [] })
        .mockResolvedValueOnce({ id: 'launch-1', status: 'completed', timeline: [] }),
    });
    const runtime = createRuntime({
      loadLaunch: vi
        .fn()
        .mockResolvedValue({ id: 'launch-1', status: 'queued', timeline: [] }),
      streamLaunch: vi.fn(async function* () {
        yield { kind: 'message' as const, launch: { id: 'launch-1', status: 'completed', timeline: [] } };
        return { id: 'launch-1', status: 'completed', timeline: [] };
      }) as any,
    });
    const sdk = createLaunchSdk({ api, runtime });

    const statuses: string[] = [];
    for await (const event of sdk.observeLaunch('launch-1', null, {
      pollIntervalMs: 0,
      retryDelayMs: 0,
    })) {
      statuses.push(event.launch.status);
    }

    expect(statuses).toEqual(['queued', 'completed']);
  });
});
