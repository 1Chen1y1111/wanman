import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEnvBackedWanmanHostSdk, createWanmanHostSdk, type WanmanHostSdkAdapters } from './host-sdk-factory.js'

interface ConcreteTakeoverOptions {
  projectPath: string
  goalOverride?: string
  runtime: 'claude' | 'codex'
  githubToken?: string
  local: boolean
  enableBrain: boolean
}

const preparedLaunch = {
  id: 'launch-1',
}

const adapters = vi.hoisted(() => ({
  runGoal: vi.fn(),
  prepareTakeoverLaunch: vi.fn(),
  executePreparedTakeoverLaunch: vi.fn(),
}))

const hostSdkAdapters: WanmanHostSdkAdapters<Record<string, never>, typeof preparedLaunch, ConcreteTakeoverOptions> = {
  runGoal: adapters.runGoal,
  prepareTakeoverLaunch: adapters.prepareTakeoverLaunch,
  executePreparedTakeoverLaunch: adapters.executePreparedTakeoverLaunch,
  normalizeTakeoverOptions(options, defaultMode) {
    if ('local' in options) return options

    return {
      projectPath: options.projectPath,
      goalOverride: options.goalOverride,
      runtime: options.runtime ?? 'claude',
      githubToken: options.githubToken,
      local: (options.mode ?? defaultMode) === 'local',
      enableBrain: options.enableBrain ?? true,
    }
  },
}

describe('createWanmanHostSdk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adapters.prepareTakeoverLaunch.mockReturnValue(preparedLaunch)
  })

  it('defaults runs to sandbox mode and overlays Sandbank config', async () => {
    const sdk = createWanmanHostSdk(
      {
        sandbank: {
          apiUrl: 'https://sandbox.example.com',
          apiKey: 'sb-key',
          image: 'codebox-pro',
          cloneFrom: 'box-1',
        },
      },
      hostSdkAdapters,
    )

    await sdk.run('ship the feature')

    expect(adapters.runGoal).toHaveBeenCalledWith(
      'ship the feature',
      expect.objectContaining({
        local: false,
        loops: 100,
        output: './deliverables',
      }),
      {},
      expect.objectContaining({
        hostEnv: expect.objectContaining({
          SANDBANK_URL: 'https://sandbox.example.com',
          SANDBANK_API_KEY: 'sb-key',
          SANDBANK_CLOUD_IMAGE: 'codebox-pro',
          SANDBANK_CLONE_FROM: 'box-1',
        }),
      }),
    )
  })

  it('treats local mode as an explicit override', async () => {
    const sdk = createWanmanHostSdk({}, hostSdkAdapters)

    await sdk.run('debug locally', { mode: 'local', keep: true })

    expect(adapters.runGoal).toHaveBeenCalledWith(
      'debug locally',
      expect.objectContaining({
        local: true,
        keep: true,
      }),
      {},
      expect.any(Object),
    )
  })

  it('normalizes takeover launches around sandbox-first defaults', async () => {
    const sdk = createWanmanHostSdk({}, hostSdkAdapters)

    const launch = sdk.prepareTakeover({
      projectPath: '/repo',
      goalOverride: 'stabilize release',
    })
    await sdk.executePreparedTakeover(launch)

    expect(adapters.prepareTakeoverLaunch).toHaveBeenCalledWith({
      projectPath: '/repo',
      goalOverride: 'stabilize release',
      runtime: 'claude',
      githubToken: undefined,
      local: false,
      enableBrain: true,
    })
    expect(adapters.executePreparedTakeoverLaunch).toHaveBeenCalledWith(
      preparedLaunch,
      expect.objectContaining({
        local: false,
        infinite: true,
        loops: Infinity,
      }),
      expect.any(Object),
    )
  })
})

describe('createEnvBackedWanmanHostSdk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads Sandbank config from env so callers do not pass it per launch', async () => {
    const sdk = createEnvBackedWanmanHostSdk(
      {
        SANDBANK_URL: 'https://sandbox.example.com',
        SANDBANK_API_KEY: 'sb-key',
      },
      {},
      hostSdkAdapters,
    )

    await sdk.run('deploy')

    expect(adapters.runGoal).toHaveBeenCalledWith(
      'deploy',
      expect.objectContaining({ local: false }),
      {},
      expect.objectContaining({
        hostEnv: expect.objectContaining({
          SANDBANK_URL: 'https://sandbox.example.com',
          SANDBANK_API_KEY: 'sb-key',
        }),
      }),
    )
  })
})
