import { describe, expect, it } from 'vitest';
import {
  getLaunchUpdatedAt,
  isLiveLaunch,
  isTerminalLaunchStatus,
  shouldPollLaunch,
} from './launch.js';

describe('launch helpers', () => {
  it('detects terminal statuses', () => {
    expect(isTerminalLaunchStatus('completed')).toBe(true);
    expect(isTerminalLaunchStatus('failed')).toBe(true);
    expect(isTerminalLaunchStatus('queued')).toBe(false);
  });

  it('decides when launches should poll', () => {
    expect(shouldPollLaunch({ status: 'queued' })).toBe(true);
    expect(shouldPollLaunch({ status: 'running' })).toBe(true);
    expect(shouldPollLaunch({ status: 'completed' })).toBe(false);
    expect(shouldPollLaunch(null)).toBe(false);
  });

  it('prefers heartbeat timestamps', () => {
    expect(getLaunchUpdatedAt({
      heartbeat_at: 20,
      updated_at: 10,
      created_at: 5,
    })).toBe(20);
  });

  it('detects live launches', () => {
    expect(isLiveLaunch({ status: 'running' } as any)).toBe(true);
    expect(isLiveLaunch({ status: 'completed' } as any)).toBe(false);
  });
});
