import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaunchClaimRecord, LaunchRunnerApiClient, LaunchRecord } from '@wanman/core'
import type { WanmanHostSdk } from './host-sdk.js'
import { runLaunchRunnerOnce } from './launch-runner.js'

function createClient(overrides: Partial<LaunchRunnerApiClient> = {}): LaunchRunnerApiClient {
  return {
    claimNextLaunch: vi.fn(),
    heartbeatLaunch: vi.fn(),
    completeLaunch: vi.fn(),
    failLaunch: vi.fn(),
    appendLaunchEvent: vi.fn().mockResolvedValue({
      id: 1,
      launch_id: 'launch-1',
      actor: 'runner',
      event_type: 'execution.started',
      message: null,
      payload: null,
      created_at: 1,
    }),
    ...overrides,
  }
}

function createSdk(overrides: Partial<WanmanHostSdk> = {}): WanmanHostSdk {
  return {
    run: vi.fn(),
    prepareTakeover: vi.fn() as any,
    executePreparedTakeover: vi.fn(),
    takeover: vi.fn(),
    ...overrides,
  }
}

function createClaim(launch: Partial<LaunchRecord>): LaunchClaimRecord {
  return {
    claim_token: 'claim-1',
    launch: {
      id: 'launch-1',
      user_id: 'user-1',
      story_id: null,
      kind: 'run',
      status: 'running',
      mode: 'sandbox',
      runtime: 'claude',
      goal: 'Ship v1',
      repo_url: null,
      repo_ref: null,
      output_path: null,
      error: null,
      payload: { goal: 'Ship v1' },
      attempt_count: 0,
      max_attempts: 3,
      created_at: 1,
      updated_at: 1,
      heartbeat_at: null,
      started_at: 1,
      completed_at: null,
      ...launch,
    },
  }
}

describe('runLaunchRunnerOnce', () => {
  let logger: Pick<Console, 'log' | 'error'>

  beforeEach(() => {
    logger = {
      log: vi.fn(),
      error: vi.fn(),
    }
  })

  it('returns without work when no launch is queued', async () => {
    const client = createClient({
      claimNextLaunch: vi.fn().mockResolvedValue(null),
    })

    const result = await runLaunchRunnerOnce({
      client,
      sdk: createSdk(),
      sleep: vi.fn(),
      prepareTakeoverProject: vi.fn(),
      logger,
    })

    expect(result).toEqual({ claimed: false })
  })

  it('executes a run launch via the host sdk', async () => {
    const client = createClient({
      claimNextLaunch: vi.fn().mockResolvedValue(createClaim({ payload: { goal: 'Ship v1', runtime: 'codex' } })),
      completeLaunch: vi.fn().mockResolvedValue(undefined),
    })
    const sdk = createSdk({
      run: vi.fn().mockResolvedValue(undefined),
    })

    const result = await runLaunchRunnerOnce({
      client,
      sdk,
      sleep: vi.fn(),
      prepareTakeoverProject: vi.fn(),
      logger,
    }, {
      outputRoot: '/tmp/wanman-launches',
    })

    expect(result).toEqual({ claimed: true, status: 'completed' })
    expect(sdk.run).toHaveBeenCalledWith('Ship v1', expect.objectContaining({
      mode: 'sandbox',
      runtime: 'codex',
      output: '/tmp/wanman-launches/launch-1',
    }))
    expect(client.appendLaunchEvent).toHaveBeenCalledWith('launch-1', expect.objectContaining({
      claim_token: 'claim-1',
      event_type: 'execution.started',
    }))
    expect(client.appendLaunchEvent).toHaveBeenCalledWith('launch-1', expect.objectContaining({
      claim_token: 'claim-1',
      event_type: 'execution.completed',
    }))
    expect(client.completeLaunch).toHaveBeenCalledWith('launch-1', { claim_token: 'claim-1' })
  })

  it('executes a takeover launch after preparing a repo checkout', async () => {
    const client = createClient({
      claimNextLaunch: vi.fn().mockResolvedValue(createClaim({
        kind: 'takeover',
        story_id: 'story-1',
        payload: {
          repo_url: 'https://github.com/acme/repo',
          repo_ref: 'main',
          goal_override: 'Stabilize release',
          repo_auth: 'runner_env',
          enable_brain: true,
        },
      })),
      completeLaunch: vi.fn().mockResolvedValue(undefined),
    })
    const sdk = createSdk({
      takeover: vi.fn().mockResolvedValue(undefined),
    })
    const cleanup = vi.fn().mockResolvedValue(undefined)

    const result = await runLaunchRunnerOnce({
      client,
      sdk,
      sleep: vi.fn(),
      prepareTakeoverProject: vi.fn().mockResolvedValue({
        projectPath: '/tmp/repo',
        cleanup,
      }),
      storySyncUrl: 'https://api.example.com/api/sync',
      storySyncSecret: 'sync-secret',
      logger,
    }, {
      outputRoot: '/tmp/wanman-launches',
    })

    expect(result).toEqual({ claimed: true, status: 'completed' })
    expect(sdk.takeover).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: '/tmp/repo',
      goalOverride: 'Stabilize release',
      mode: 'sandbox',
      storySync: {
        storyId: 'story-1',
        syncUrl: 'https://api.example.com/api/sync',
        syncSecret: 'sync-secret',
      },
    }), expect.objectContaining({
      mode: 'sandbox',
      noBrain: false,
      output: '/tmp/wanman-launches/launch-1',
    }))
    expect(client.appendLaunchEvent).toHaveBeenCalledWith('launch-1', expect.objectContaining({
      claim_token: 'claim-1',
      event_type: 'project.materialization.started',
      payload: expect.objectContaining({
        repo_auth: 'runner_env',
      }),
    }))
    expect(client.appendLaunchEvent).toHaveBeenCalledWith('launch-1', expect.objectContaining({
      claim_token: 'claim-1',
      event_type: 'project.materialization.completed',
    }))
    expect(cleanup).toHaveBeenCalled()
  })

  it('marks a launch as failed when execution throws', async () => {
    const client = createClient({
      claimNextLaunch: vi.fn().mockResolvedValue(createClaim({ payload: { goal: 'Ship v1' } })),
      failLaunch: vi.fn().mockResolvedValue(undefined),
    })
    const sdk = createSdk({
      run: vi.fn().mockRejectedValue(new Error('boom')),
    })

    const result = await runLaunchRunnerOnce({
      client,
      sdk,
      sleep: vi.fn(),
      prepareTakeoverProject: vi.fn(),
      logger,
    })

    expect(result).toEqual({ claimed: true, status: 'failed' })
    expect(client.appendLaunchEvent).toHaveBeenCalledWith('launch-1', expect.objectContaining({
      claim_token: 'claim-1',
      event_type: 'execution.failed',
      message: 'boom',
    }))
    expect(client.failLaunch).toHaveBeenCalledWith('launch-1', {
      claim_token: 'claim-1',
      error: 'boom',
    })
  })
})
