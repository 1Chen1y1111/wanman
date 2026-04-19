import type {
  LaunchDetailRecord,
  LaunchRecord,
  RunLaunchInputRecord,
  TakeoverLaunchInputRecord,
} from './types.js';

export interface LaunchResponseRecord {
  launch: LaunchRecord;
}

export interface LaunchListResponseRecord {
  launches: LaunchRecord[];
}

export interface LaunchDetailResponseRecord {
  launch: LaunchDetailRecord;
}

export interface LaunchApiRequest {
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
}

export type LaunchApiTransport = <TResponse>(request: LaunchApiRequest) => Promise<TResponse>;

export interface LaunchApiClient {
  listLaunches(): Promise<LaunchRecord[]>;
  getLaunch(launchId: string): Promise<LaunchDetailRecord>;
  createRunLaunch(input: RunLaunchInputRecord): Promise<LaunchRecord>;
  createTakeoverLaunch(input: TakeoverLaunchInputRecord): Promise<LaunchRecord>;
  cancelLaunch(launchId: string): Promise<LaunchRecord>;
  retryLaunch(launchId: string): Promise<LaunchRecord>;
  streamLaunchPath(launchId: string): string;
}

function encodeLaunchId(launchId: string): string {
  return encodeURIComponent(launchId);
}

export function buildLaunchesPath(): string {
  return '/api/launches';
}

export function buildLaunchPath(launchId: string): string {
  return `${buildLaunchesPath()}/${encodeLaunchId(launchId)}`;
}

export function buildRunLaunchPath(): string {
  return `${buildLaunchesPath()}/run`;
}

export function buildTakeoverLaunchPath(): string {
  return `${buildLaunchesPath()}/takeover`;
}

export function buildRetryLaunchPath(launchId: string): string {
  return `${buildLaunchPath(launchId)}/retry`;
}

export function buildCancelLaunchPath(launchId: string): string {
  return `${buildLaunchPath(launchId)}/cancel`;
}

export function buildLaunchStreamPath(launchId: string): string {
  return `${buildLaunchPath(launchId)}/stream`;
}

export function createLaunchApiClient(transport: LaunchApiTransport): LaunchApiClient {
  return {
    async listLaunches() {
      const response = await transport<LaunchListResponseRecord>({
        path: buildLaunchesPath(),
      });
      return response.launches;
    },
    async getLaunch(launchId) {
      const response = await transport<LaunchDetailResponseRecord>({
        path: buildLaunchPath(launchId),
      });
      return response.launch;
    },
    async createRunLaunch(input) {
      const response = await transport<LaunchResponseRecord>({
        path: buildRunLaunchPath(),
        method: 'POST',
        body: input,
      });
      return response.launch;
    },
    async createTakeoverLaunch(input) {
      const response = await transport<LaunchResponseRecord>({
        path: buildTakeoverLaunchPath(),
        method: 'POST',
        body: input,
      });
      return response.launch;
    },
    async cancelLaunch(launchId) {
      const response = await transport<LaunchResponseRecord>({
        path: buildCancelLaunchPath(launchId),
        method: 'POST',
      });
      return response.launch;
    },
    async retryLaunch(launchId) {
      const response = await transport<LaunchResponseRecord>({
        path: buildRetryLaunchPath(launchId),
        method: 'POST',
      });
      return response.launch;
    },
    streamLaunchPath(launchId) {
      return buildLaunchStreamPath(launchId);
    },
  };
}
