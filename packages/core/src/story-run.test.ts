import { describe, expect, it } from 'vitest'

import {
  canControlStoryRun,
  getStoryRunControlError,
  isFailedStoryRun,
  isLiveStoryRun,
  isProvisioningStoryRun,
  isTerminalStoryRun,
  shouldPollStoryRun,
  shouldStreamStoryRun,
} from './story-run.js'

describe('story run lifecycle helpers', () => {
  it('classifies pollable, live, and terminal statuses consistently', () => {
    expect(shouldPollStoryRun('pending')).toBe(true)
    expect(shouldPollStoryRun('provisioning')).toBe(true)
    expect(shouldPollStoryRun('running')).toBe(false)

    expect(shouldStreamStoryRun('running')).toBe(true)
    expect(shouldStreamStoryRun('paused')).toBe(true)
    expect(shouldStreamStoryRun('completed')).toBe(false)

    expect(isLiveStoryRun('running')).toBe(true)
    expect(isLiveStoryRun('paused')).toBe(true)
    expect(isProvisioningStoryRun('pending')).toBe(true)
    expect(isProvisioningStoryRun('provisioning')).toBe(true)
    expect(isFailedStoryRun('failed')).toBe(true)
    expect(isTerminalStoryRun('cancelled')).toBe(true)
  })

  it('enforces story control transitions with stable error messages', () => {
    expect(canControlStoryRun('pending', 'start')).toBe(true)
    expect(canControlStoryRun('running', 'pause')).toBe(true)
    expect(canControlStoryRun('paused', 'resume')).toBe(true)
    expect(canControlStoryRun('paused', 'stop')).toBe(true)

    expect(getStoryRunControlError('running', 'start')).toBe('Story already started')
    expect(getStoryRunControlError('pending', 'pause')).toBe('Story is not running')
    expect(getStoryRunControlError('running', 'resume')).toBe('Story is not paused')
    expect(getStoryRunControlError('completed', 'stop')).toBe('Story is not active')
  })
})
