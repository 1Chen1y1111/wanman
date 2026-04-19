import type { StoryRunControlAction, StoryRunStatus } from './types.js'

export const STORY_RUN_POLLABLE_STATUSES = ['pending', 'provisioning'] as const satisfies readonly StoryRunStatus[]
export const STORY_RUN_LIVE_STATUSES = ['running', 'paused'] as const satisfies readonly StoryRunStatus[]
export const STORY_RUN_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const satisfies readonly StoryRunStatus[]

const STORY_RUN_CONTROL_STATUSES = {
  start: ['pending'],
  pause: ['running'],
  resume: ['paused'],
  stop: ['running', 'paused'],
} as const satisfies Record<StoryRunControlAction, readonly StoryRunStatus[]>

function isStoryRunOneOf(
  status: StoryRunStatus | null | undefined,
  allowed: readonly StoryRunStatus[],
): status is StoryRunStatus {
  return !!status && allowed.includes(status)
}

export function shouldPollStoryRun(status: StoryRunStatus | null | undefined): boolean {
  return isStoryRunOneOf(status, STORY_RUN_POLLABLE_STATUSES)
}

export function shouldStreamStoryRun(status: StoryRunStatus | null | undefined): boolean {
  return isStoryRunOneOf(status, STORY_RUN_LIVE_STATUSES)
}

export function isLiveStoryRun(status: StoryRunStatus | null | undefined): boolean {
  return isStoryRunOneOf(status, STORY_RUN_LIVE_STATUSES)
}

export function isProvisioningStoryRun(status: StoryRunStatus | null | undefined): boolean {
  return status === 'pending' || status === 'provisioning'
}

export function isFailedStoryRun(status: StoryRunStatus | null | undefined): boolean {
  return status === 'failed'
}

export function isTerminalStoryRun(status: StoryRunStatus | null | undefined): boolean {
  return isStoryRunOneOf(status, STORY_RUN_TERMINAL_STATUSES)
}

export function canControlStoryRun(
  status: StoryRunStatus | null | undefined,
  action: StoryRunControlAction,
): status is StoryRunStatus {
  return isStoryRunOneOf(status, STORY_RUN_CONTROL_STATUSES[action])
}

export function getStoryRunControlError(
  status: StoryRunStatus | null | undefined,
  action: StoryRunControlAction,
): string | null {
  if (canControlStoryRun(status, action)) return null

  switch (action) {
    case 'start':
      return 'Story already started'
    case 'pause':
      return 'Story is not running'
    case 'resume':
      return 'Story is not paused'
    case 'stop':
      return 'Story is not active'
  }
}
