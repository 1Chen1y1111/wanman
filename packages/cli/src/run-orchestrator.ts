import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AgentRuntime } from '@wanman/core'
import type { ProjectRunSpec, RunOptions } from './execution-session.js'
import { detectRequiredRuntimes } from './sandbox-auth.js'

export interface RunLaunchPlan {
  requestedProjectDir?: string
  projectDir?: string
  repoSourceDir?: string
  sandboxRepoRoot?: string
  sandboxGitRoot?: string
  localGitRoot?: string
  workspaceRoot: string
}

export interface RunSessionPlan {
  brainName?: string
  runId: string
  configName: string
  sourceLabel: string
  useThirdPartyApi: boolean
  useHybrid: boolean
  runtimeOverride?: string
  codexModelOverride?: string
  codexReasoningEffort?: string
  requiredRuntimes: AgentRuntime[]
  runtimeLabel: string
  llmModeLabel: string
  codexConfigLabel: string | null
}

export function resolveRequestedProjectDir(projectDir?: string): string | undefined {
  if (!projectDir) return undefined

  const resolvedProjectDir = path.resolve(projectDir)
  if (!fs.existsSync(resolvedProjectDir)) {
    throw new Error(`Project directory does not exist: ${resolvedProjectDir}`)
  }
  if (!fs.statSync(resolvedProjectDir).isDirectory()) {
    throw new Error(`Project directory is not a directory: ${resolvedProjectDir}`)
  }

  return resolvedProjectDir
}

export function createRunLaunchPlan(opts: Pick<RunOptions, 'projectDir'>, spec: ProjectRunSpec = {}): RunLaunchPlan {
  const requestedProjectDir = resolveRequestedProjectDir(opts.projectDir)
  const projectDir = spec.projectDir
  const repoSourceDir = spec.repoSourceDir ?? (!spec.repoCloneUrl ? requestedProjectDir : undefined)
  const sandboxRepoRoot = spec.sandboxRepoRoot ?? (repoSourceDir ? '/workspace/project' : undefined)
  const sandboxGitRoot = spec.gitRoot ?? sandboxRepoRoot
  const localGitRoot = spec.gitRoot ?? repoSourceDir ?? requestedProjectDir
  const workspaceRoot = spec.workspaceRoot ?? '/workspace/agents'

  return {
    requestedProjectDir,
    projectDir,
    repoSourceDir,
    sandboxRepoRoot,
    sandboxGitRoot,
    localGitRoot,
    workspaceRoot,
  }
}

export function getRunSourceLabel(
  plan: Pick<RunLaunchPlan, 'projectDir' | 'requestedProjectDir'>,
  options: { standalone: boolean },
): string {
  if (plan.projectDir) return `project (${path.basename(plan.projectDir)})`
  if (plan.requestedProjectDir) return `working dir (${path.basename(plan.requestedProjectDir)})`
  return options.standalone ? 'standalone' : 'monorepo'
}

export function buildRunBrainName(goal: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16)
  const slug = goal.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase() || 'goal'
  return `wanman-run-${ts}-${slug}`
}

export function createRunSessionPlan(args: {
  goal: string
  opts: Pick<RunOptions, 'runtime' | 'codexModel' | 'codexReasoningEffort' | 'workerUrl'>
  launchPlan: Pick<RunLaunchPlan, 'projectDir' | 'requestedProjectDir'>
  configName: string
  configText: string
  standalone: boolean
  db9Token?: string
  env?: NodeJS.ProcessEnv
}): RunSessionPlan {
  const env = args.env ?? process.env
  const brainName = args.db9Token ? buildRunBrainName(args.goal) : undefined
  const runId = brainName || `run-${Date.now().toString(36)}`
  const useThirdPartyApi = !!env['ANTHROPIC_BASE_URL']
  const useHybrid = !!args.opts.workerUrl
  const runtimeOverride = args.opts.runtime ?? env['WANMAN_RUNTIME']
  const codexModelOverride = args.opts.codexModel
    ?? env['WANMAN_CODEX_MODEL']
    ?? (runtimeOverride === 'codex' ? env['WANMAN_MODEL'] : undefined)
  const codexReasoningEffort = args.opts.codexReasoningEffort ?? env['WANMAN_CODEX_REASONING_EFFORT']
  const requiredRuntimes = detectRequiredRuntimes(args.configText, runtimeOverride)
  const runtimeLabel = runtimeOverride || (requiredRuntimes.length === 1 ? requiredRuntimes[0]! : requiredRuntimes.join(', '))
  const llmModeLabel = useHybrid
    ? 'hybrid-worker'
    : requiredRuntimes.every(runtime => runtime === 'codex')
      ? 'codex-cli'
      : useThirdPartyApi
        ? 'anthropic-compatible'
        : 'claude-cli'
  const shouldShowCodexConfig = runtimeOverride === 'codex' || requiredRuntimes.some(runtime => runtime === 'codex')

  return {
    brainName,
    runId,
    configName: args.configName,
    sourceLabel: getRunSourceLabel(args.launchPlan, { standalone: args.standalone }),
    useThirdPartyApi,
    useHybrid,
    runtimeOverride,
    codexModelOverride,
    codexReasoningEffort,
    requiredRuntimes,
    runtimeLabel,
    llmModeLabel,
    codexConfigLabel: shouldShowCodexConfig
      ? `${codexModelOverride ?? 'default'} / ${codexReasoningEffort ?? 'default'}`
      : null,
  }
}

export function createSandboxRuntimeEnv(args: {
  opts: Pick<RunOptions, 'codexModel' | 'codexReasoningEffort' | 'workerUrl' | 'workerKey' | 'workerModel'>
  db9Token?: string
  brainName?: string
  runtimeOverride?: string
  workspaceRoot: string
  sandboxGitRoot?: string
  storySync?: ProjectRunSpec['storySync']
  env?: NodeJS.ProcessEnv
}): Record<string, string> {
  const baseEnv = args.env ?? process.env
  const env: Record<string, string> = {
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  }

  if (args.db9Token) {
    env['DB9_TOKEN'] = args.db9Token
    if (args.brainName) env['WANMAN_BRAIN_NAME'] = args.brainName
  }
  if (baseEnv['ANTHROPIC_BASE_URL']) env['ANTHROPIC_BASE_URL'] = baseEnv['ANTHROPIC_BASE_URL']
  if (baseEnv['ANTHROPIC_AUTH_TOKEN']) env['ANTHROPIC_AUTH_TOKEN'] = baseEnv['ANTHROPIC_AUTH_TOKEN']
  if (args.runtimeOverride) env['WANMAN_RUNTIME'] = args.runtimeOverride
  if (args.opts.codexModel) env['WANMAN_CODEX_MODEL'] = args.opts.codexModel
  else if (baseEnv['WANMAN_CODEX_MODEL']) env['WANMAN_CODEX_MODEL'] = baseEnv['WANMAN_CODEX_MODEL']
  if (args.opts.codexReasoningEffort) env['WANMAN_CODEX_REASONING_EFFORT'] = args.opts.codexReasoningEffort
  else if (baseEnv['WANMAN_CODEX_REASONING_EFFORT']) env['WANMAN_CODEX_REASONING_EFFORT'] = baseEnv['WANMAN_CODEX_REASONING_EFFORT']
  if (baseEnv['WANMAN_MODEL']) env['WANMAN_MODEL'] = baseEnv['WANMAN_MODEL']
  if (args.workspaceRoot !== '/workspace/agents') env['WANMAN_WORKSPACE'] = args.workspaceRoot
  if (args.sandboxGitRoot) env['WANMAN_GIT_ROOT'] = args.sandboxGitRoot
  if (args.storySync?.storyId) {
    env['WANMAN_STORY_ID'] = args.storySync.storyId
    const syncUrl = args.storySync.syncUrl ?? baseEnv['WANMAN_SYNC_URL']
    if (syncUrl) env['WANMAN_SYNC_URL'] = syncUrl
    const syncSecret = args.storySync.syncSecret ?? baseEnv['WANMAN_SYNC_SECRET']
    if (syncSecret) env['WANMAN_SYNC_SECRET'] = syncSecret
  }
  if (args.opts.workerUrl) env['WANMAN_WORKER_BASE_URL'] = args.opts.workerUrl
  if (args.opts.workerKey) env['WANMAN_WORKER_API_KEY'] = args.opts.workerKey
  if (args.opts.workerModel) env['WANMAN_WORKER_MODEL'] = args.opts.workerModel

  return env
}
