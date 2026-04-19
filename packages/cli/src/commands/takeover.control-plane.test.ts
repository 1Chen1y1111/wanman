import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectProfile } from './takeover.js'
import type { RunOptions } from '@wanman/host-sdk'

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(),
  createTakeoverLaunch: vi.fn(),
  createCliLaunchSdk: vi.fn(),
  resolveCliLaunchApiOptions: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execSync: mocks.execSync,
}))

vi.mock('../launch-api-client.js', () => ({
  createCliLaunchSdk: mocks.createCliLaunchSdk,
  resolveCliLaunchApiOptions: mocks.resolveCliLaunchApiOptions,
}))

import {
  buildTakeoverLaunchInput,
  listUnsupportedTakeoverControlPlaneReasons,
  queueTakeoverCommand,
} from './takeover.js'

function makeProfile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  return {
    path: '/tmp/repo',
    languages: ['typescript'],
    packageManagers: ['pnpm'],
    frameworks: ['react'],
    ci: ['github-actions'],
    testFrameworks: ['vitest'],
    hasReadme: true,
    hasClaudeMd: false,
    hasDocs: true,
    issueTracker: 'github',
    githubRemote: 'https://github.com/acme/repo',
    codeRoots: ['src'],
    packageScripts: ['test'],
    ...overrides,
  }
}

function makeRunOptions(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    loops: Infinity,
    pollInterval: 15,
    runtime: 'codex',
    codexModel: 'gpt-5.4',
    codexReasoningEffort: 'high',
    configPath: undefined,
    projectDir: undefined,
    workerUrl: undefined,
    workerModel: undefined,
    workerKey: 'lmstudio',
    noBrain: false,
    keep: false,
    output: './deliverables',
    cloneFrom: undefined,
    local: false,
    infinite: true,
    errorLimit: 20,
    ...overrides,
  }
}

describe('takeover control-plane routing', () => {
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
    consoleWarn.mockClear()
    consoleLog.mockClear()

    mocks.resolveCliLaunchApiOptions.mockReturnValue({
      apiBaseUrl: 'https://api.wanman.test',
      token: 'token-123',
    })
    mocks.createCliLaunchSdk.mockReturnValue({
      createTakeoverLaunch: mocks.createTakeoverLaunch,
    })
    mocks.createTakeoverLaunch.mockResolvedValue({
      id: 'launch-1',
      status: 'queued',
    })
  })

  it('builds a takeover launch payload from local preview data', () => {
    expect(buildTakeoverLaunchInput(
      makeProfile(),
      'codex',
      makeRunOptions(),
      'runner_env',
      'Stabilize release',
      'main',
    )).toEqual({
      repo_url: 'https://github.com/acme/repo',
      repo_ref: 'main',
      goal_override: 'Stabilize release',
      repo_auth: 'runner_env',
      mode: 'sandbox',
      runtime: 'codex',
      loops: null,
      infinite: true,
      poll_interval: 15,
      keep: false,
      enable_brain: true,
      output: './deliverables',
      codex_model: 'gpt-5.4',
      codex_reasoning_effort: 'high',
    })
  })

  it('reports the reasons that block takeover queueing', () => {
    expect(listUnsupportedTakeoverControlPlaneReasons(
      makeProfile({ githubRemote: undefined, issueTracker: 'none' }),
      makeRunOptions({ configPath: './agents.json' }),
      {
        activeBranch: 'feature/refactor',
        branchAhead: 2,
        hasUpstream: true,
        modifiedFiles: ['README.md'],
      },
      'explicit-token',
    )).toEqual([
      '--config',
      'missing GitHub remote',
      'local uncommitted changes',
      'local commits ahead of origin',
      '--github-token',
    ])
  })

  it('queues clean GitHub takeovers through the launch control plane', async () => {
    mocks.execSync.mockReturnValue([
      '# branch.oid 123456',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +0 -0',
    ].join('\n'))

    await expect(queueTakeoverCommand(
      makeProfile(),
      'claude',
      makeRunOptions({ runtime: 'claude', codexModel: undefined, codexReasoningEffort: undefined }),
      'runner_env',
      'Stabilize release',
    )).resolves.toBe(true)

    expect(mocks.createTakeoverLaunch).toHaveBeenCalledWith(expect.objectContaining({
      repo_url: 'https://github.com/acme/repo',
      repo_ref: 'main',
      goal_override: 'Stabilize release',
      repo_auth: 'runner_env',
      runtime: 'claude',
    }))
  })

  it('falls back to direct execution when local git state would be lost', async () => {
    mocks.execSync.mockReturnValue([
      '# branch.oid 123456',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +1 -0',
      '1 .M N... 100644 100644 100644 abc def README.md',
    ].join('\n'))

    await expect(queueTakeoverCommand(
      makeProfile(),
      'claude',
      makeRunOptions(),
      'public',
    )).resolves.toBe(false)

    expect(mocks.createTakeoverLaunch).not.toHaveBeenCalled()
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('local uncommitted changes'))
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('local commits ahead of origin'))
  })
})
