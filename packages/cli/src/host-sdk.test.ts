import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreparedTakeoverLaunch } from './takeover-launch.js'

const mocks = vi.hoisted(() => ({
  runGoal: vi.fn(),
  prepareTakeoverLaunch: vi.fn(),
  executePreparedTakeoverLaunch: vi.fn(),
}))

vi.mock('./run-host.js', () => ({
  runGoal: mocks.runGoal,
}))

vi.mock('./takeover-launch.js', () => ({
  prepareTakeoverLaunch: mocks.prepareTakeoverLaunch,
  executePreparedTakeoverLaunch: mocks.executePreparedTakeoverLaunch,
}))

import { createEnvBackedWanmanHostSdk, createWanmanHostSdk } from './host-sdk.js'

const preparedLaunch = {
  profile: {} as any,
  generated: {} as any,
  overlayDir: '/tmp/takeover',
  local: false,
  useGitClone: false,
} satisfies PreparedTakeoverLaunch

describe('createWanmanHostSdk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prepareTakeoverLaunch.mockReturnValue(preparedLaunch)
  })

  it('defaults run launches to sandbox mode and overlays Sandbank config', async () => {
    const sdk = createWanmanHostSdk({
      sandbank: {
        apiUrl: 'https://sandbox.example.com',
        apiKey: 'sb-key',
        image: 'codebox-pro',
        cloneFrom: 'box-1',
      },
    })

    await sdk.run('ship the feature')

    expect(mocks.runGoal).toHaveBeenCalledWith(
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
    const sdk = createWanmanHostSdk()

    await sdk.run('debug locally', { mode: 'local', keep: true })

    expect(mocks.runGoal).toHaveBeenCalledWith(
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
    const sdk = createWanmanHostSdk()

    const launch = sdk.prepareTakeover({
      projectPath: '/repo',
      goalOverride: 'stabilize release',
    })
    await sdk.executePreparedTakeover(launch)

    expect(mocks.prepareTakeoverLaunch).toHaveBeenCalledWith({
      projectPath: '/repo',
      goalOverride: 'stabilize release',
      runtime: 'claude',
      githubToken: undefined,
      local: false,
      enableBrain: true,
    })
    expect(mocks.executePreparedTakeoverLaunch).toHaveBeenCalledWith(
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
    const sdk = createEnvBackedWanmanHostSdk({
      SANDBANK_URL: 'https://sandbox.example.com',
      SANDBANK_API_KEY: 'sb-key',
    })

    await sdk.run('deploy')

    expect(mocks.runGoal).toHaveBeenCalledWith(
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
