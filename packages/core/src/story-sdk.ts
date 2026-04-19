import {
  createStoryApiClient,
  type CreateStoryThreadInputRecord,
  type CreateStoryInputRecord,
  type StoryApiClient,
  type StoryApiTransport,
  type StoryDeleteResponseRecord,
  type StoryThreadCreateResponseRecord,
} from './story-api.js';
import {
  createStoryRuntimeClient,
  type StoryRuntimeClient,
  type StoryRuntimeEventRecord,
  type StoryRuntimeStreamTransport,
  type StoryRuntimeWatchOptionsRecord,
} from './story-runtime.js';
import {
  observeStorySession,
  type StoryObserveSessionOptionsRecord,
} from './story-observer.js';
import { applyStoryRunControlResponse, type StorySessionStateRecord } from './story-session.js';
import type {
  StoryArtifactRecord,
  StoryDetailRecord,
  StoryRunControlAction,
  StoryRunControlResponseRecord,
  StoryRunDetailRecord,
  StorySummaryRecord,
  StoryTaskRecord,
  StoryViewRecord,
} from './types.js';

export interface StoryControlResultRecord<TStory extends StoryViewRecord | null | undefined = StoryViewRecord | null | undefined> {
  response: StoryRunControlResponseRecord;
  story: TStory;
}

export interface StoryCreateAndStartResultRecord {
  story: StoryViewRecord;
  response: StoryRunControlResponseRecord;
}

export interface StorySdkClient {
  api: StoryApiClient;
  runtime: StoryRuntimeClient;
  listStories(): Promise<StorySummaryRecord[]>;
  getStory(storyId: string): Promise<StoryDetailRecord>;
  getCurrentRun(storyId: string): Promise<StoryRunDetailRecord | null>;
  createStory(input: CreateStoryInputRecord): Promise<StoryViewRecord>;
  createAndStartStory(input: CreateStoryInputRecord): Promise<StoryCreateAndStartResultRecord>;
  loadSession<
    TStory extends StoryDetailRecord = StoryDetailRecord,
    TArtifact extends { id: string } = StoryArtifactRecord,
    TTask extends { id: string } = StoryTaskRecord,
  >(
    storyId: string,
    current?: StorySessionStateRecord<TStory | null, TArtifact, TTask>,
  ): Promise<StorySessionStateRecord<TStory, TArtifact, TTask>>;
  streamSession<
    TStory extends StoryDetailRecord = StoryDetailRecord,
    TArtifact extends { id: string } = StoryArtifactRecord,
    TTask extends { id: string } = StoryTaskRecord,
  >(
    storyId: string,
    current: StorySessionStateRecord<TStory, TArtifact, TTask>,
    options?: StoryRuntimeWatchOptionsRecord,
  ): AsyncGenerator<StoryRuntimeEventRecord<TStory, TArtifact, TTask>, StorySessionStateRecord<TStory, TArtifact, TTask>>;
  watchSession<
    TStory extends StoryDetailRecord = StoryDetailRecord,
    TArtifact extends { id: string } = StoryArtifactRecord,
    TTask extends { id: string } = StoryTaskRecord,
  >(
    storyId: string,
    current?: StorySessionStateRecord<TStory | null, TArtifact, TTask>,
    options?: StoryRuntimeWatchOptionsRecord,
  ): AsyncGenerator<StoryRuntimeEventRecord<TStory, TArtifact, TTask>, StorySessionStateRecord<TStory, TArtifact, TTask>>;
  observeSession<
    TStory extends StoryDetailRecord = StoryDetailRecord,
    TArtifact extends { id: string } = StoryArtifactRecord,
    TTask extends { id: string } = StoryTaskRecord,
  >(
    storyId: string,
    current?: StorySessionStateRecord<TStory | null, TArtifact, TTask>,
    options?: StoryObserveSessionOptionsRecord,
  ): AsyncGenerator<StoryRuntimeEventRecord<TStory, TArtifact, TTask>, StorySessionStateRecord<TStory, TArtifact, TTask>>;
  controlStory<TStory extends StoryViewRecord | null | undefined = StoryViewRecord | null | undefined>(
    storyId: string,
    action: StoryRunControlAction,
    current?: TStory,
  ): Promise<StoryControlResultRecord<TStory>>;
  startStory<TStory extends StoryViewRecord | null | undefined = StoryViewRecord | null | undefined>(
    storyId: string,
    current?: TStory,
  ): Promise<StoryControlResultRecord<TStory>>;
  pauseStory<TStory extends StoryViewRecord | null | undefined = StoryViewRecord | null | undefined>(
    storyId: string,
    current?: TStory,
  ): Promise<StoryControlResultRecord<TStory>>;
  resumeStory<TStory extends StoryViewRecord | null | undefined = StoryViewRecord | null | undefined>(
    storyId: string,
    current?: TStory,
  ): Promise<StoryControlResultRecord<TStory>>;
  stopStory<TStory extends StoryViewRecord | null | undefined = StoryViewRecord | null | undefined>(
    storyId: string,
    current?: TStory,
  ): Promise<StoryControlResultRecord<TStory>>;
  sendThreadMessage(storyId: string, input: CreateStoryThreadInputRecord): Promise<StoryThreadCreateResponseRecord>;
  deleteStory(storyId: string): Promise<StoryDeleteResponseRecord>;
}

export type StorySdkFactoryArgs =
  | {
      api: StoryApiClient;
      runtime: StoryRuntimeClient;
    }
  | {
      transport: StoryApiTransport;
      openStream: StoryRuntimeStreamTransport;
    };

export function createStorySdk(args: StorySdkFactoryArgs): StorySdkClient {
  const api = 'api' in args ? args.api : createStoryApiClient(args.transport);
  const runtime = 'runtime' in args
    ? args.runtime
    : createStoryRuntimeClient({
        api,
        openStream: args.openStream,
      });

  const control = async <TStory extends StoryViewRecord | null | undefined>(
    storyId: string,
    action: StoryRunControlAction,
    current?: TStory,
  ): Promise<StoryControlResultRecord<TStory>> => {
    const response = await requestStoryControl(api, storyId, action);
    return {
      response,
      story: applyStoryRunControlResponse(current, response) as TStory,
    };
  };

  const sdk: StorySdkClient = {
    api,
    runtime,
    listStories() {
      return api.listStories();
    },
    getStory(storyId) {
      return api.getStory(storyId);
    },
    getCurrentRun(storyId) {
      return api.getCurrentRun(storyId);
    },
    async createStory(input) {
      return api.createStory(input);
    },
    async createAndStartStory(input) {
      const story = await api.createStory(input);
      const response = await api.startStory(story.id);
      return {
        story: applyStoryRunControlResponse(story, response) as StoryViewRecord,
        response,
      };
    },
    loadSession(storyId, current) {
      return runtime.loadSession(storyId, current);
    },
    streamSession(storyId, current, options) {
      return runtime.streamSession(storyId, current, options);
    },
    watchSession(storyId, current, options) {
      return runtime.watchSession(storyId, current, options);
    },
    observeSession(storyId, current, options) {
      return observeStorySession(sdk, storyId, current, options);
    },
    controlStory(storyId, action, current) {
      return control(storyId, action, current);
    },
    startStory(storyId, current) {
      return control(storyId, 'start', current);
    },
    pauseStory(storyId, current) {
      return control(storyId, 'pause', current);
    },
    resumeStory(storyId, current) {
      return control(storyId, 'resume', current);
    },
    stopStory(storyId, current) {
      return control(storyId, 'stop', current);
    },
    sendThreadMessage(storyId, input) {
      return api.sendThreadMessage(storyId, input);
    },
    deleteStory(storyId) {
      return api.deleteStory(storyId);
    },
  };

  return sdk;
}

async function requestStoryControl(
  api: StoryApiClient,
  storyId: string,
  action: StoryRunControlAction,
): Promise<StoryRunControlResponseRecord> {
  switch (action) {
    case 'start':
      return api.startStory(storyId);
    case 'pause':
      return api.pauseStory(storyId);
    case 'resume':
      return api.resumeStory(storyId);
    case 'stop':
      return api.stopStory(storyId);
  }
}
