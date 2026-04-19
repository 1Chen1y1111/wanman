import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  createRunLaunch: vi.fn(),
  createEnvBackedWanmanHostSdk: vi.fn(),
  createCliLaunchSdk: vi.fn(),
  resolveCliLaunchApiOptions: vi.fn(),
}))

vi.mock('../host-sdk.js', () => ({
  createEnvBackedWanmanHostSdk: mocks.createEnvBackedWanmanHostSdk,
}))

vi.mock('../launch-api-client.js', () => ({
  createCliLaunchSdk: mocks.createCliLaunchSdk,
  resolveCliLaunchApiOptions: mocks.resolveCliLaunchApiOptions,
}))

import {
  buildRunLaunchInput,
  listUnsupportedRunControlPlaneFlags,
  queueRunCommand,
  runCommand,
} from './run.js'

describe('run control plane routing', () => {
  const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
    consoleLog.mockClear()
    consoleWarn.mockClear()

    mocks.createEnvBackedWanmanHostSdk.mockReturnValue({
      run: mocks.run,
    })
    mocks.createCliLaunchSdk.mockReturnValue({
      createRunLaunch: mocks.createRunLaunch,
    })
    mocks.resolveCliLaunchApiOptions.mockReturnValue({
      apiBaseUrl: 'https://api.example.com',
      token: 'token-123',
    })
    mocks.createRunLaunch.mockResolvedValue({
      id: 'launch-1',
      status: 'queued',
    })
  })

  it('builds a launch payload from supported run options', () => {
    const payload = buildRunLaunchInput('Ship v1', {
      loops: 20,
      pollInterval: 30,
      runtime: 'codex',
      codexModel: 'gpt-5.4',
      codexReasoningEffort: 'high',
      configPath: undefined,
      projectDir: undefined,
      workerUrl: undefined,
      workerModel: undefined,
      workerKey: 'lmstudio',
      noBrain: true,
      keep: true,
      output: '/tmp/out',
      cloneFrom: undefined,
      local: false,
      infinite: false,
      errorLimit: 20,
    })

    expect(payload).toEqual({
      goal: 'Ship v1',
      mode: 'sandbox',
      runtime: 'codex',
      loops: 20,
      infinite: false,
      poll_interval: 30,
      keep: true,
      no_brain: true,
      output: '/tmp/out',
      codex_model: 'gpt-5.4',
      codex_reasoning_effort: 'high',
    })
  })

  it('lists the flags that still require direct host execution', () => {
    expect(listUnsupportedRunControlPlaneFlags({
      loops: 100,
      pollInterval: 15,
      runtime: undefined,
      codexModel: undefined,
      codexReasoningEffort: undefined,
      configPath: './agents.json',
      projectDir: '/tmp/repo',
      workerUrl: 'http://localhost:4000',
      workerModel: 'worker-model',
      workerKey: 'custom',
      noBrain: false,
      keep: false,
      output: './deliverables',
      cloneFrom: 'box-1',
      local: false,
      infinite: false,
      errorLimit: 20,
    })).toEqual([
      '--config',
      '--project-dir',
      '--worker-url',
      '--worker-model',
      '--worker-key',
      '--clone-from',
    ])
  })

  it('queues sandbox-compatible runs through the launch control plane', async () => {
    await runCommand(['Ship v1'])

    expect(mocks.createRunLaunch).toHaveBeenCalledWith(expect.objectContaining({
      goal: 'Ship v1',
      mode: 'sandbox',
    }))
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('falls back to direct host execution for local runs', async () => {
    await runCommand(['Debug locally', '--local'])

    expect(mocks.createRunLaunch).not.toHaveBeenCalled()
    expect(mocks.run).toHaveBeenCalledWith('Debug locally', expect.objectContaining({
      local: true,
    }), {})
  })

  it('falls back to direct execution when unsupported flags are present', async () => {
    await expect(queueRunCommand('Ship v1', {
      loops: 100,
      pollInterval: 15,
      runtime: undefined,
      codexModel: undefined,
      codexReasoningEffort: undefined,
      configPath: './agents.json',
      projectDir: undefined,
      workerUrl: undefined,
      workerModel: undefined,
      workerKey: 'lmstudio',
      noBrain: false,
      keep: false,
      output: './deliverables',
      cloneFrom: undefined,
      local: false,
      infinite: false,
      errorLimit: 20,
    })).resolves.toBe(false)

    expect(mocks.createRunLaunch).not.toHaveBeenCalled()
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('--config'),
    )
  })
})
