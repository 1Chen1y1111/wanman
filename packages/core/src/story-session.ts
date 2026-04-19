import {
  isFailedStoryRun,
  isLiveStoryRun,
  isProvisioningStoryRun,
  shouldPollStoryRun,
  shouldStreamStoryRun,
} from './story-run.js';
import type {
  StoryArtifactRecord,
  StoryRunControlResponseRecord,
  StoryRunDetailRecord,
  StoryRunEventRecord,
  StoryRunRecord,
  StoryRunStatus,
  StoryStreamMessageRecord,
  StoryThreadMessageRecord,
  StoryTaskRecord,
  StoryViewRecord,
} from './types.js';

export interface StorySessionStateRecord<
  TStory extends StoryViewRecord | null = StoryViewRecord | null,
  TArtifact extends { id: string } = StoryArtifactRecord,
  TTask extends { id: string } = StoryTaskRecord,
> {
  story: TStory;
  artifacts: TArtifact[];
  tasks: TTask[];
  loading: boolean;
}

type StoryRunLike = Pick<StoryViewRecord, 'status' | 'current_run' | 'created_at'>;

function isTerminalStatus(status: StoryRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function getStoryRunStatus(story: StoryRunLike | null | undefined): StoryRunStatus | null {
  return story?.current_run?.status ?? story?.status ?? null;
}

export function getStoryRunUpdatedAt(story: StoryRunLike | null | undefined): number | null {
  return story?.current_run?.updated_at ?? story?.created_at ?? null;
}

export function shouldPollStoryView(story: StoryRunLike | null | undefined): boolean {
  return shouldPollStoryRun(getStoryRunStatus(story));
}

export function shouldStreamStoryView(story: StoryRunLike | null | undefined): boolean {
  return shouldStreamStoryRun(getStoryRunStatus(story));
}

export function isStoryViewLive(story: StoryRunLike | null | undefined): boolean {
  return isLiveStoryRun(getStoryRunStatus(story));
}

export function isStoryViewProvisioning(story: StoryRunLike | null | undefined): boolean {
  return isProvisioningStoryRun(getStoryRunStatus(story));
}

export function isStoryViewFailed(story: StoryRunLike | null | undefined): boolean {
  return isFailedStoryRun(getStoryRunStatus(story));
}

export function patchStoryRunStatus<TStory extends StoryViewRecord | null | undefined>(
  story: TStory,
  status: StoryRunStatus,
): TStory {
  if (!story) return story;

  return {
    ...story,
    status,
    current_run: story.current_run
      ? {
          ...story.current_run,
          status,
          completed_at: isTerminalStatus(status)
            ? story.current_run.completed_at ?? Math.floor(Date.now() / 1000)
            : story.current_run.completed_at,
        }
      : story.current_run,
  } as TStory;
}

export function applyStoryRunSummary<TStory extends StoryViewRecord | null | undefined>(
  story: TStory,
  currentRun: StoryRunRecord | null | undefined,
): TStory {
  if (!story || !currentRun) return story;

  const mergedCurrentRun = story.current_run && 'timeline' in story.current_run
    ? {
        ...story.current_run,
        ...currentRun,
      }
    : currentRun;

  return {
    ...story,
    status: currentRun.status,
    run_id: currentRun.id,
    sandbox_id: currentRun.sandbox_id,
    sandbox_url: currentRun.sandbox_url,
    started_at: currentRun.started_at,
    completed_at: currentRun.completed_at,
    current_run: mergedCurrentRun,
  } as TStory;
}

export function applyStoryRunControlResponse<TStory extends StoryViewRecord | null | undefined>(
  story: TStory,
  response: StoryRunControlResponseRecord,
): TStory {
  if (response.current_run) return applyStoryRunSummary(story, response.current_run);
  return patchStoryRunStatus(story, response.status);
}

export function mergeStreamEntityById<TItem extends { id: string | number }>(
  items: TItem[],
  item: TItem,
): TItem[] {
  const index = items.findIndex(existing => existing.id === item.id);
  if (index < 0) return [...items, item];

  const next = [...items];
  next[index] = item;
  return next;
}

export function mergeStoryRunEvent<TStory extends StoryViewRecord | null | undefined>(
  story: TStory,
  event: StoryRunEventRecord,
): TStory {
  if (!story) return story;

  const currentRun = story.current_run;
  const currentTimeline = currentRun && 'timeline' in currentRun && Array.isArray(currentRun.timeline)
    ? currentRun.timeline
    : [];
  const nextTimeline = currentTimeline.some((existing) => existing.id === event.id)
    ? currentTimeline
    : [...currentTimeline, event];

  return {
    ...story,
    status: event.status ?? story.status,
    run_id: event.run_id,
    sandbox_id: extractSandboxId(event) ?? story.sandbox_id,
    current_run: {
      id: event.run_id,
      story_id: story.id,
      status: event.status ?? currentRun?.status ?? story.status,
      sandbox_id: extractSandboxId(event) ?? currentRun?.sandbox_id ?? story.sandbox_id,
      sandbox_url: currentRun?.sandbox_url ?? story.sandbox_url,
      started_at: currentRun?.started_at ?? story.started_at,
      completed_at: event.status && isTerminalStatus(event.status)
        ? currentRun?.completed_at ?? event.created_at
        : currentRun?.completed_at ?? story.completed_at,
      created_at: currentRun?.created_at ?? story.started_at ?? story.created_at,
      updated_at: event.created_at,
      timeline: nextTimeline,
    } satisfies StoryRunDetailRecord,
  } as TStory;
}

export function mergeStoryThreadMessage<TStory extends StoryViewRecord | null | undefined>(
  story: TStory,
  message: StoryThreadMessageRecord,
): TStory {
  if (!story) return story;

  return {
    ...story,
    threads: mergeStreamEntityById(story.threads ?? [], message),
  } as TStory;
}

export function hydrateStorySessionState<
  TStory extends StoryViewRecord,
  TArtifact extends { id: string },
  TTask extends { id: string },
>(
  current: StorySessionStateRecord<TStory | null, TArtifact, TTask>,
  data: TStory & { artifacts?: TArtifact[]; tasks?: TTask[] },
): StorySessionStateRecord<TStory, TArtifact, TTask> {
  return {
    story: data,
    artifacts: data.artifacts ?? current.artifacts,
    tasks: data.tasks ?? current.tasks,
    loading: false,
  };
}

export function applyStoryStreamMessage<
  TStory extends StoryViewRecord | null,
  TArtifact extends { id: string },
  TTask extends { id: string },
>(
  current: StorySessionStateRecord<TStory, TArtifact, TTask>,
  message: StoryStreamMessageRecord,
): StorySessionStateRecord<TStory, TArtifact, TTask> {
  if (message.eventType === 'artifact') {
    return {
      ...current,
      artifacts: mergeStreamEntityById(current.artifacts, message.data as TArtifact),
    };
  }

  if (message.eventType === 'task') {
    return {
      ...current,
      tasks: mergeStreamEntityById(current.tasks, message.data as TTask),
    };
  }

  if (message.eventType === 'status') {
    const status = (message.data as { status?: StoryRunStatus }).status;
    if (!status) return current;

    return {
      ...current,
      story: patchStoryRunStatus(current.story, status) as TStory,
    };
  }

  if (message.eventType === 'run') {
    return {
      ...current,
      story: mergeStoryRunEvent(current.story, message.data as StoryRunEventRecord) as TStory,
    };
  }

  if (message.eventType === 'thread') {
    return {
      ...current,
      story: mergeStoryThreadMessage(current.story, message.data as StoryThreadMessageRecord) as TStory,
    };
  }

  return current;
}

export function parseStoryStreamChunk(
  buffer: string,
  chunk: string,
): { buffer: string; messages: StoryStreamMessageRecord[] } {
  const chunks = (buffer + chunk).split('\n\n');
  const nextBuffer = chunks.pop() ?? '';
  const messages: StoryStreamMessageRecord[] = [];

  for (const rawMessage of chunks) {
    let eventType = '';
    let eventData = '';

    for (const line of rawMessage.split('\n')) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7);
      } else if (line.startsWith('data: ')) {
        eventData = line.slice(6);
      }
    }

    if (!eventData) continue;

    try {
      messages.push({ eventType, data: JSON.parse(eventData) });
    } catch {
      // Ignore malformed payloads and continue parsing the stream.
    }
  }

  return { buffer: nextBuffer, messages };
}

function extractSandboxId(event: StoryRunEventRecord): string | null | undefined {
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return undefined;
  const sandboxId = (event.payload as { sandbox_id?: unknown }).sandbox_id;
  return typeof sandboxId === 'string' ? sandboxId : undefined;
}
