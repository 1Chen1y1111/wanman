import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  buildRunBrainName,
  createRunSessionPlan,
  createSandboxRuntimeEnv,
  createRunLaunchPlan,
  getRunSourceLabel,
  resolveRequestedProjectDir,
} from './run-orchestrator.js'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    existsSync: vi.fn(),
    statSync: vi.fn(),
  }
})

const mockExistsSync = vi.mocked(fs.existsSync)
const mockStatSync = vi.mocked(fs.statSync)

describe('run orchestrator helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates and resolves the requested project directory', () => {
    mockExistsSync.mockReturnValue(true)
    mockStatSync.mockReturnValue({ isDirectory: () => true } as fs.Stats)

    const result = resolveRequestedProjectDir('./tmp/project')

    expect(result).toBe(path.resolve('./tmp/project'))
  })

  it('derives launch defaults for sandbox and local git roots', () => {
    mockExistsSync.mockReturnValue(true)
    mockStatSync.mockReturnValue({ isDirectory: () => true } as fs.Stats)

    const plan = createRunLaunchPlan(
      { projectDir: './tmp/project' },
      { projectDir: '/tmp/overlay' },
    )

    expect(plan.requestedProjectDir).toBe(path.resolve('./tmp/project'))
    expect(plan.projectDir).toBe('/tmp/overlay')
    expect(plan.repoSourceDir).toBe(path.resolve('./tmp/project'))
    expect(plan.sandboxRepoRoot).toBe('/workspace/project')
    expect(plan.sandboxGitRoot).toBe('/workspace/project')
    expect(plan.localGitRoot).toBe(path.resolve('./tmp/project'))
    expect(plan.workspaceRoot).toBe('/workspace/agents')
  })

  it('respects explicit repo and workspace overrides', () => {
    const plan = createRunLaunchPlan(
      { projectDir: undefined },
      {
        repoCloneUrl: 'https://github.com/wanman/wanman.ai',
        repoSourceDir: '/tmp/source',
        sandboxRepoRoot: '/workspace/repo',
        workspaceRoot: '/workspace/custom-agents',
        gitRoot: '/workspace/repo',
      },
    )

    expect(plan.repoSourceDir).toBe('/tmp/source')
    expect(plan.sandboxRepoRoot).toBe('/workspace/repo')
    expect(plan.sandboxGitRoot).toBe('/workspace/repo')
    expect(plan.localGitRoot).toBe('/workspace/repo')
    expect(plan.workspaceRoot).toBe('/workspace/custom-agents')
  })

  it('describes the resolved run source consistently', () => {
    expect(getRunSourceLabel({ projectDir: '/tmp/overlay', requestedProjectDir: '/tmp/source' }, { standalone: false })).toBe('project (overlay)')
    expect(getRunSourceLabel({ projectDir: undefined, requestedProjectDir: '/tmp/source' }, { standalone: false })).toBe('working dir (source)')
    expect(getRunSourceLabel({ projectDir: undefined, requestedProjectDir: undefined }, { standalone: true })).toBe('standalone')
    expect(getRunSourceLabel({ projectDir: undefined, requestedProjectDir: undefined }, { standalone: false })).toBe('monorepo')
  })

  it('builds a run session plan from launch context and environment', () => {
    const plan = createRunSessionPlan({
      goal: 'Launch the moonshot beta',
      opts: {
        runtime: undefined,
        codexModel: undefined,
        codexReasoningEffort: undefined,
        workerUrl: undefined,
      },
      launchPlan: {
        projectDir: '/tmp/overlay',
        requestedProjectDir: '/tmp/source',
      },
      configName: 'agents.json (project)',
      configText: JSON.stringify({
        agents: [
          { name: 'ceo', lifecycle: '24/7', runtime: 'codex' },
        ],
      }),
      standalone: false,
      db9Token: 'db9-token',
      env: {
        ANTHROPIC_BASE_URL: 'https://api.example.com',
        WANMAN_CODEX_MODEL: 'gpt-5.4',
      },
    })

    expect(plan.configName).toBe('agents.json (project)')
    expect(plan.sourceLabel).toBe('project (overlay)')
    expect(plan.useThirdPartyApi).toBe(true)
    expect(plan.useHybrid).toBe(false)
    expect(plan.requiredRuntimes).toEqual(['codex'])
    expect(plan.runtimeLabel).toBe('codex')
    expect(plan.llmModeLabel).toBe('codex-cli')
    expect(plan.codexConfigLabel).toBe('gpt-5.4 / default')
    expect(plan.brainName).toMatch(/^wanman-run-/)
    expect(plan.runId).toBe(plan.brainName)
  })

  it('builds sandbox runtime env from opts and process env defaults', () => {
    const env = createSandboxRuntimeEnv({
      opts: {
        codexModel: undefined,
        codexReasoningEffort: 'high',
        workerUrl: 'https://worker.example.com',
        workerKey: 'worker-key',
        workerModel: 'gpt-worker',
      },
      db9Token: 'db9-token',
      brainName: 'wanman-run-test',
      runtimeOverride: 'codex',
      workspaceRoot: '/workspace/custom-agents',
      sandboxGitRoot: '/workspace/project',
      storySync: {
        storyId: 'story-1',
        syncUrl: 'https://api.example.com/api/sync',
        syncSecret: 'sync-secret',
      },
      env: {
        ANTHROPIC_BASE_URL: 'https://api.example.com',
        ANTHROPIC_AUTH_TOKEN: 'anthropic-token',
        WANMAN_CODEX_MODEL: 'gpt-5.4',
        WANMAN_MODEL: 'fallback-model',
      },
    })

    expect(env).toMatchObject({
      DB9_TOKEN: 'db9-token',
      WANMAN_BRAIN_NAME: 'wanman-run-test',
      ANTHROPIC_BASE_URL: 'https://api.example.com',
      ANTHROPIC_AUTH_TOKEN: 'anthropic-token',
      WANMAN_RUNTIME: 'codex',
      WANMAN_CODEX_MODEL: 'gpt-5.4',
      WANMAN_CODEX_REASONING_EFFORT: 'high',
      WANMAN_MODEL: 'fallback-model',
      WANMAN_WORKSPACE: '/workspace/custom-agents',
      WANMAN_GIT_ROOT: '/workspace/project',
      WANMAN_STORY_ID: 'story-1',
      WANMAN_SYNC_URL: 'https://api.example.com/api/sync',
      WANMAN_SYNC_SECRET: 'sync-secret',
      WANMAN_WORKER_BASE_URL: 'https://worker.example.com',
      WANMAN_WORKER_API_KEY: 'worker-key',
      WANMAN_WORKER_MODEL: 'gpt-worker',
    })
  })

  it('generates stable brain names from goals', () => {
    expect(buildRunBrainName('Launch beta now')).toMatch(/^wanman-run-/)
  })
})
