import {
  createLaunchApiClient,
  type LaunchApiClient,
  type LaunchApiTransport,
} from './launch-api.js';
import {
  createLaunchRuntimeClient,
  type LaunchRuntimeClient,
  type LaunchRuntimeEventRecord,
  type LaunchRuntimeStreamTransport,
  type LaunchRuntimeWatchOptionsRecord,
} from './launch-runtime.js';
import { observeLaunch, type LaunchObserveOptionsRecord } from './launch-observer.js';
import type {
  LaunchDetailRecord,
  LaunchRecord,
  RunLaunchInputRecord,
  TakeoverLaunchInputRecord,
} from './types.js';

export interface LaunchSdkClient {
  api: LaunchApiClient;
  runtime: LaunchRuntimeClient;
  listLaunches(): Promise<LaunchRecord[]>;
  getLaunch<TLaunch extends LaunchDetailRecord = LaunchDetailRecord>(launchId: string): Promise<TLaunch>;
  loadLaunch<TLaunch extends LaunchDetailRecord = LaunchDetailRecord>(launchId: string): Promise<TLaunch>;
  createRunLaunch(input: RunLaunchInputRecord): Promise<LaunchRecord>;
  createTakeoverLaunch(input: TakeoverLaunchInputRecord): Promise<LaunchRecord>;
  cancelLaunch(launchId: string): Promise<LaunchRecord>;
  retryLaunch(launchId: string): Promise<LaunchRecord>;
  streamLaunch<TLaunch extends LaunchDetailRecord = LaunchDetailRecord>(
    launchId: string,
    current: TLaunch,
    options?: LaunchRuntimeWatchOptionsRecord,
  ): AsyncGenerator<LaunchRuntimeEventRecord<TLaunch>, TLaunch>;
  watchLaunch<TLaunch extends LaunchDetailRecord = LaunchDetailRecord>(
    launchId: string,
    current?: TLaunch | null,
    options?: LaunchRuntimeWatchOptionsRecord,
  ): AsyncGenerator<LaunchRuntimeEventRecord<TLaunch>, TLaunch>;
  observeLaunch<TLaunch extends LaunchDetailRecord = LaunchDetailRecord>(
    launchId: string,
    current?: TLaunch | null,
    options?: LaunchObserveOptionsRecord,
  ): AsyncGenerator<LaunchRuntimeEventRecord<TLaunch>, TLaunch>;
}

export type LaunchSdkFactoryArgs =
  | {
      api: LaunchApiClient;
      runtime: LaunchRuntimeClient;
    }
  | {
      transport: LaunchApiTransport;
      openStream: LaunchRuntimeStreamTransport;
    };

export function createLaunchSdk(args: LaunchSdkFactoryArgs): LaunchSdkClient {
  const api = 'api' in args ? args.api : createLaunchApiClient(args.transport);
  const runtime = 'runtime' in args
    ? args.runtime
    : createLaunchRuntimeClient({
        api,
        openStream: args.openStream,
      });

  const sdk: LaunchSdkClient = {
    api,
    runtime,
    listLaunches() {
      return api.listLaunches();
    },
    getLaunch<TLaunch extends LaunchDetailRecord = LaunchDetailRecord>(launchId: string) {
      return api.getLaunch(launchId) as Promise<TLaunch>;
    },
    loadLaunch(launchId) {
      return runtime.loadLaunch(launchId);
    },
    createRunLaunch(input) {
      return api.createRunLaunch(input);
    },
    createTakeoverLaunch(input) {
      return api.createTakeoverLaunch(input);
    },
    cancelLaunch(launchId) {
      return api.cancelLaunch(launchId);
    },
    retryLaunch(launchId) {
      return api.retryLaunch(launchId);
    },
    streamLaunch(launchId, current, options) {
      return runtime.streamLaunch(launchId, current, options);
    },
    watchLaunch(launchId, current, options) {
      return runtime.watchLaunch(launchId, current, options);
    },
    observeLaunch(launchId, current, options) {
      return observeLaunch(sdk, launchId, current, options);
    },
  };

  return sdk;
}
