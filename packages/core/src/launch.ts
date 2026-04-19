import type { LaunchDetailRecord, LaunchRecord, LaunchStatus } from './types.js';

export const LAUNCH_TERMINAL_STATUSES: readonly LaunchStatus[] = [
  'completed',
  'failed',
  'cancelled',
] as const;

export function isTerminalLaunchStatus(status: LaunchStatus): boolean {
  return LAUNCH_TERMINAL_STATUSES.includes(status);
}

export function shouldPollLaunch(launch: Pick<LaunchRecord, 'status'> | null | undefined): boolean {
  return Boolean(launch && !isTerminalLaunchStatus(launch.status));
}

export function shouldStreamLaunch(launch: Pick<LaunchRecord, 'status'> | null | undefined): boolean {
  return shouldPollLaunch(launch);
}

export function getLaunchUpdatedAt(launch: Pick<LaunchRecord, 'heartbeat_at' | 'updated_at' | 'created_at'> | null | undefined): number | null {
  if (!launch) return null;
  return launch.heartbeat_at ?? launch.updated_at ?? launch.created_at ?? null;
}

export function isLiveLaunch(launch: Pick<LaunchDetailRecord, 'status'> | null | undefined): boolean {
  return Boolean(launch && !isTerminalLaunchStatus(launch.status));
}
