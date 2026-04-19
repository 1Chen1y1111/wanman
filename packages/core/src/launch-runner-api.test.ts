import { describe, expect, it, vi } from 'vitest';
import type { LaunchRunnerApiTransport } from './launch-runner-api.js';
import {
  buildClaimNextLaunchPath,
  buildInternalLaunchesPath,
  buildLaunchCompletePath,
  buildLaunchEventsPath,
  buildLaunchFailPath,
  buildLaunchHeartbeatPath,
  createLaunchRunnerApiClient,
} from './launch-runner-api.js';

describe('launch-runner-api paths', () => {
  it('builds internal runner paths', () => {
    expect(buildInternalLaunchesPath()).toBe('/internal/launches');
    expect(buildClaimNextLaunchPath()).toBe('/internal/launches/claim');
    expect(buildLaunchHeartbeatPath('launch 1')).toBe('/internal/launches/launch%201/heartbeat');
    expect(buildLaunchCompletePath('launch 1')).toBe('/internal/launches/launch%201/complete');
    expect(buildLaunchFailPath('launch 1')).toBe('/internal/launches/launch%201/fail');
    expect(buildLaunchEventsPath('launch 1')).toBe('/internal/launches/launch%201/events');
  });
});

describe('createLaunchRunnerApiClient', () => {
  it('claims the next launch', async () => {
    const transport = vi.fn(async () => ({
      claim: {
        claim_token: 'token-1',
        launch: { id: 'launch-1', kind: 'run' },
      },
    })) as LaunchRunnerApiTransport;
    const client = createLaunchRunnerApiClient(transport);

    await expect(client.claimNextLaunch({ runner_id: 'runner-1' })).resolves.toEqual({
      claim_token: 'token-1',
      launch: { id: 'launch-1', kind: 'run' },
    });
  });

  it('sends heartbeat, complete, and fail actions', async () => {
    const transport = vi.fn(async () => ({ ok: true })) as LaunchRunnerApiTransport;
    const client = createLaunchRunnerApiClient(transport);

    await client.heartbeatLaunch('launch-1', { claim_token: 'token-1' });
    await client.completeLaunch('launch-1', { claim_token: 'token-1' });
    await client.failLaunch('launch-1', { claim_token: 'token-1', error: 'boom' });

    expect(transport).toHaveBeenNthCalledWith(1, {
      path: '/internal/launches/launch-1/heartbeat',
      method: 'POST',
      body: { claim_token: 'token-1' },
    });
    expect(transport).toHaveBeenNthCalledWith(2, {
      path: '/internal/launches/launch-1/complete',
      method: 'POST',
      body: { claim_token: 'token-1' },
    });
    expect(transport).toHaveBeenNthCalledWith(3, {
      path: '/internal/launches/launch-1/fail',
      method: 'POST',
      body: { claim_token: 'token-1', error: 'boom' },
    });
  });

  it('appends a launch event', async () => {
    const transport = vi.fn(async () => ({
      event: {
        id: 1,
        launch_id: 'launch-1',
        actor: 'runner',
        event_type: 'execution.started',
        message: 'Execution started',
        payload: { phase: 'execute' },
        created_at: 1,
      },
    })) as LaunchRunnerApiTransport;
    const client = createLaunchRunnerApiClient(transport);

    await expect(client.appendLaunchEvent('launch-1', {
      claim_token: 'token-1',
      event_type: 'execution.started',
      message: 'Execution started',
      payload: { phase: 'execute' },
    })).resolves.toEqual({
      id: 1,
      launch_id: 'launch-1',
      actor: 'runner',
      event_type: 'execution.started',
      message: 'Execution started',
      payload: { phase: 'execute' },
      created_at: 1,
    });

    expect(transport).toHaveBeenCalledWith({
      path: '/internal/launches/launch-1/events',
      method: 'POST',
      body: {
        claim_token: 'token-1',
        event_type: 'execution.started',
        message: 'Execution started',
        payload: { phase: 'execute' },
      },
    });
  });
});
