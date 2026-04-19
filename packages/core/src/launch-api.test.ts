import { describe, expect, it, vi } from 'vitest';
import type { LaunchApiTransport } from './launch-api.js';
import {
    buildLaunchPath,
    buildLaunchesPath,
    buildCancelLaunchPath,
    buildRetryLaunchPath,
  buildRunLaunchPath,
  buildLaunchStreamPath,
  buildTakeoverLaunchPath,
  createLaunchApiClient,
} from './launch-api.js';

describe('launch-api paths', () => {
  it('builds launch paths', () => {
    expect(buildLaunchesPath()).toBe('/api/launches');
    expect(buildRunLaunchPath()).toBe('/api/launches/run');
    expect(buildTakeoverLaunchPath()).toBe('/api/launches/takeover');
    expect(buildLaunchPath('launch 1')).toBe('/api/launches/launch%201');
    expect(buildCancelLaunchPath('launch 1')).toBe('/api/launches/launch%201/cancel');
    expect(buildRetryLaunchPath('launch 1')).toBe('/api/launches/launch%201/retry');
    expect(buildLaunchStreamPath('launch 1')).toBe('/api/launches/launch%201/stream');
  });
});

describe('createLaunchApiClient', () => {
  it('lists launches', async () => {
    const transport = vi.fn(async () => ({
      launches: [{ id: 'launch-1', status: 'queued' }],
    })) as LaunchApiTransport;
    const client = createLaunchApiClient(transport);

    await expect(client.listLaunches()).resolves.toEqual([{ id: 'launch-1', status: 'queued' }]);
    expect(transport).toHaveBeenCalledWith({ path: '/api/launches' });
  });

  it('creates a run launch', async () => {
    const transport = vi.fn(async () => ({
      launch: { id: 'launch-1', kind: 'run', status: 'queued' },
    })) as LaunchApiTransport;
    const client = createLaunchApiClient(transport);

    await expect(client.createRunLaunch({ goal: 'ship it' })).resolves.toEqual({
      id: 'launch-1',
      kind: 'run',
      status: 'queued',
    });
    expect(transport).toHaveBeenCalledWith({
      path: '/api/launches/run',
      method: 'POST',
      body: { goal: 'ship it' },
    });
  });

  it('creates a takeover launch', async () => {
    const transport = vi.fn(async () => ({
      launch: { id: 'launch-2', kind: 'takeover', status: 'queued' },
    })) as LaunchApiTransport;
    const client = createLaunchApiClient(transport);

    await expect(client.createTakeoverLaunch({
      repo_url: 'https://github.com/acme/repo',
      repo_auth: 'runner_env',
    })).resolves.toEqual({
      id: 'launch-2',
      kind: 'takeover',
      status: 'queued',
    });
    expect(transport).toHaveBeenCalledWith({
      path: '/api/launches/takeover',
      method: 'POST',
      body: { repo_url: 'https://github.com/acme/repo', repo_auth: 'runner_env' },
    });
  });

  it('gets a launch', async () => {
    const transport = vi.fn(async () => ({
      launch: { id: 'launch-1', status: 'queued', timeline: [] },
    })) as LaunchApiTransport;
    const client = createLaunchApiClient(transport);

    await expect(client.getLaunch('launch-1')).resolves.toEqual({ id: 'launch-1', status: 'queued', timeline: [] });
    expect(transport).toHaveBeenCalledWith({ path: '/api/launches/launch-1' });
  });

  it('retries a launch', async () => {
    const transport = vi.fn(async () => ({
      launch: { id: 'launch-1', status: 'queued' },
    })) as LaunchApiTransport;
    const client = createLaunchApiClient(transport);

    await expect(client.retryLaunch('launch-1')).resolves.toEqual({ id: 'launch-1', status: 'queued' });
    expect(transport).toHaveBeenCalledWith({
      path: '/api/launches/launch-1/retry',
      method: 'POST',
    });
  });

  it('cancels a launch', async () => {
    const transport = vi.fn(async () => ({
      launch: { id: 'launch-1', status: 'cancelled' },
    })) as LaunchApiTransport;
    const client = createLaunchApiClient(transport);

    await expect(client.cancelLaunch('launch-1')).resolves.toEqual({ id: 'launch-1', status: 'cancelled' });
    expect(transport).toHaveBeenCalledWith({
      path: '/api/launches/launch-1/cancel',
      method: 'POST',
    });
  });

  it('builds a stream path without transport', () => {
    const transport = vi.fn() as LaunchApiTransport;
    const client = createLaunchApiClient(transport);

    expect(client.streamLaunchPath('launch 1')).toBe('/api/launches/launch%201/stream');
    expect(transport).not.toHaveBeenCalled();
  });
});
