import type {
  MessagePriority,
  CurrentStoryRunResponseRecord,
  StoryDetailRecord,
  StoryRecord,
  StoryThreadComposeType,
  StoryThreadMessageRecord,
  StoryRunControlAction,
  StoryRunControlResponseRecord,
  StoryRunDetailRecord,
  StorySummaryRecord,
} from './types.js';

export interface CreateStoryInputRecord {
  name: string;
  goal: string;
  mode: StoryRecord['mode'];
  provider?: StoryRecord['provider'];
  repo_url?: StoryRecord['repo_url'];
}

export interface StoryListResponseRecord {
  stories: StorySummaryRecord[];
}

export interface StoryDeleteResponseRecord {
  status: 'deleted';
}

export interface CreateStoryThreadInputRecord {
  text: string;
  priority?: MessagePriority;
  to?: string;
  message_type?: StoryThreadComposeType;
}

export interface StoryThreadCreateResponseRecord {
  thread: StoryThreadMessageRecord;
  delivered: boolean;
  delivery_error?: string | null;
}

export interface StoryApiRequest {
  path: string;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
}

export type StoryApiTransport = <TResponse>(request: StoryApiRequest) => Promise<TResponse>;

export interface StoryApiClient {
  createStory(input: CreateStoryInputRecord): Promise<StoryRecord>;
  listStories(): Promise<StorySummaryRecord[]>;
  getStory(storyId: string): Promise<StoryDetailRecord>;
  getCurrentRun(storyId: string): Promise<StoryRunDetailRecord | null>;
  startStory(storyId: string): Promise<StoryRunControlResponseRecord>;
  pauseStory(storyId: string): Promise<StoryRunControlResponseRecord>;
  resumeStory(storyId: string): Promise<StoryRunControlResponseRecord>;
  stopStory(storyId: string): Promise<StoryRunControlResponseRecord>;
  sendThreadMessage(storyId: string, input: CreateStoryThreadInputRecord): Promise<StoryThreadCreateResponseRecord>;
  deleteStory(storyId: string): Promise<StoryDeleteResponseRecord>;
  streamStoryPath(storyId: string): string;
}

function encodeStoryId(storyId: string): string {
  return encodeURIComponent(storyId);
}

export function buildStoriesPath(): string {
  return '/api/stories';
}

export function buildStoryPath(storyId: string): string {
  return `${buildStoriesPath()}/${encodeStoryId(storyId)}`;
}

export function buildCurrentStoryRunPath(storyId: string): string {
  return `${buildStoryPath(storyId)}/runs/current`;
}

export function buildStoryControlPath(storyId: string, action: StoryRunControlAction): string {
  return `${buildStoryPath(storyId)}/${action}`;
}

export function buildStoryStreamPath(storyId: string): string {
  return `${buildStoryPath(storyId)}/stream`;
}

export function buildStoryThreadsPath(storyId: string): string {
  return `${buildStoryPath(storyId)}/threads`;
}

export function createStoryApiClient(transport: StoryApiTransport): StoryApiClient {
  return {
    createStory(input) {
      return transport<StoryRecord>({
        path: buildStoriesPath(),
        method: 'POST',
        body: input,
      });
    },
    async listStories() {
      const response = await transport<StoryListResponseRecord>({
        path: buildStoriesPath(),
      });
      return response.stories;
    },
    getStory(storyId) {
      return transport<StoryDetailRecord>({
        path: buildStoryPath(storyId),
      });
    },
    async getCurrentRun(storyId) {
      const response = await transport<CurrentStoryRunResponseRecord>({
        path: buildCurrentStoryRunPath(storyId),
      });
      return response.current_run;
    },
    startStory(storyId) {
      return transport<StoryRunControlResponseRecord>({
        path: buildStoryControlPath(storyId, 'start'),
        method: 'POST',
      });
    },
    pauseStory(storyId) {
      return transport<StoryRunControlResponseRecord>({
        path: buildStoryControlPath(storyId, 'pause'),
        method: 'POST',
      });
    },
    resumeStory(storyId) {
      return transport<StoryRunControlResponseRecord>({
        path: buildStoryControlPath(storyId, 'resume'),
        method: 'POST',
      });
    },
    stopStory(storyId) {
      return transport<StoryRunControlResponseRecord>({
        path: buildStoryControlPath(storyId, 'stop'),
        method: 'POST',
      });
    },
    sendThreadMessage(storyId, input) {
      return transport<StoryThreadCreateResponseRecord>({
        path: buildStoryThreadsPath(storyId),
        method: 'POST',
        body: input,
      });
    },
    deleteStory(storyId) {
      return transport<StoryDeleteResponseRecord>({
        path: buildStoryPath(storyId),
        method: 'DELETE',
      });
    },
    streamStoryPath(storyId) {
      return buildStoryStreamPath(storyId);
    },
  };
}
