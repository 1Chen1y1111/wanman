import type { LaunchClaimRecord, LaunchEventActor, LaunchEventRecord } from './types.js';

export interface ClaimNextLaunchRequestRecord {
  runner_id?: string | null;
}

export interface ClaimNextLaunchResponseRecord {
  claim: LaunchClaimRecord | null;
}

export interface UpdateClaimedLaunchRequestRecord {
  claim_token: string;
  error?: string | null;
}

export interface ClaimedLaunchActionResponseRecord {
  ok: true;
}

export interface AppendLaunchEventRequestRecord {
  claim_token: string;
  event_type: string;
  actor?: LaunchEventActor;
  message?: string | null;
  payload?: unknown | null;
}

export interface AppendLaunchEventResponseRecord {
  event: LaunchEventRecord;
}

export interface LaunchRunnerApiRequest {
  path: string;
  method?: 'POST';
  body?: unknown;
}

export type LaunchRunnerApiTransport = <TResponse>(request: LaunchRunnerApiRequest) => Promise<TResponse>;

export interface LaunchRunnerApiClient {
  claimNextLaunch(input?: ClaimNextLaunchRequestRecord): Promise<LaunchClaimRecord | null>;
  heartbeatLaunch(launchId: string, input: UpdateClaimedLaunchRequestRecord): Promise<void>;
  completeLaunch(launchId: string, input: UpdateClaimedLaunchRequestRecord): Promise<void>;
  failLaunch(launchId: string, input: UpdateClaimedLaunchRequestRecord): Promise<void>;
  appendLaunchEvent(launchId: string, input: AppendLaunchEventRequestRecord): Promise<LaunchEventRecord>;
}

function encodeLaunchId(launchId: string): string {
  return encodeURIComponent(launchId);
}

export function buildInternalLaunchesPath(): string {
  return '/internal/launches';
}

export function buildClaimNextLaunchPath(): string {
  return `${buildInternalLaunchesPath()}/claim`;
}

function buildClaimedLaunchActionPath(launchId: string, action: 'heartbeat' | 'complete' | 'fail'): string {
  return `${buildInternalLaunchesPath()}/${encodeLaunchId(launchId)}/${action}`;
}

export function buildLaunchEventsPath(launchId: string): string {
  return `${buildInternalLaunchesPath()}/${encodeLaunchId(launchId)}/events`;
}

export function buildLaunchHeartbeatPath(launchId: string): string {
  return buildClaimedLaunchActionPath(launchId, 'heartbeat');
}

export function buildLaunchCompletePath(launchId: string): string {
  return buildClaimedLaunchActionPath(launchId, 'complete');
}

export function buildLaunchFailPath(launchId: string): string {
  return buildClaimedLaunchActionPath(launchId, 'fail');
}

export function createLaunchRunnerApiClient(transport: LaunchRunnerApiTransport): LaunchRunnerApiClient {
  return {
    async claimNextLaunch(input = {}) {
      const response = await transport<ClaimNextLaunchResponseRecord>({
        path: buildClaimNextLaunchPath(),
        method: 'POST',
        body: input,
      });
      return response.claim;
    },
    async heartbeatLaunch(launchId, input) {
      await transport<ClaimedLaunchActionResponseRecord>({
        path: buildLaunchHeartbeatPath(launchId),
        method: 'POST',
        body: input,
      });
    },
    async completeLaunch(launchId, input) {
      await transport<ClaimedLaunchActionResponseRecord>({
        path: buildLaunchCompletePath(launchId),
        method: 'POST',
        body: input,
      });
    },
    async failLaunch(launchId, input) {
      await transport<ClaimedLaunchActionResponseRecord>({
        path: buildLaunchFailPath(launchId),
        method: 'POST',
        body: input,
      });
    },
    async appendLaunchEvent(launchId, input) {
      const response = await transport<AppendLaunchEventResponseRecord>({
        path: buildLaunchEventsPath(launchId),
        method: 'POST',
        body: input,
      });
      return response.event;
    },
  };
}
