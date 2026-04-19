import * as path from 'node:path'
import type { AgentRuntime } from '@wanman/core'
import type { ProjectRunSpec, RunOptions } from './execution-session.js'
import { buildTakeoverExecutionHooks } from './takeover-hooks.js'
import { materializeLocalTakeoverProject, runLocal } from './takeover-local.js'
import {
  type GeneratedAgentConfig,
  type ProjectProfile,
  SANDBOX_PROJECT_ROOT,
  SANDBOX_WORKSPACE_ROOT,
  generateAgentConfig,
  materializeTakeoverProject,
  scanProject,
} from './takeover-project.js'
import { runGoal, type HostRunBindings } from './run-host.js'
import { generateBootstrapScript } from './commands/runtime-bootstrap.js'
import { resolveGithubToken } from './commands/sandbox-git.js'

export interface PrepareTakeoverLaunchOptions {
  projectPath: string
  goalOverride?: string
  runtime: AgentRuntime
  githubToken?: string
  local: boolean
  enableBrain: boolean
  storySync?: ProjectRunSpec['storySync']
}

export interface PreparedTakeoverLaunch {
  profile: ProjectProfile
  generated: GeneratedAgentConfig
  overlayDir: string
  local: boolean
  useGitClone: boolean
  githubToken?: string
  bootstrapScript?: string
  runSpec?: ProjectRunSpec
}

export function prepareTakeoverLaunch(options: PrepareTakeoverLaunchOptions): PreparedTakeoverLaunch {
  const profile = scanProject(options.projectPath)
  const generated = generateAgentConfig(profile, options.goalOverride, options.runtime)
  const overlayDir = options.local
    ? materializeLocalTakeoverProject(profile, generated, { enableBrain: options.enableBrain })
    : materializeTakeoverProject(profile, generated, { enableBrain: options.enableBrain })

  const githubToken = profile.githubRemote ? resolveGithubToken(options.githubToken) : undefined
  const useGitClone = !!profile.githubRemote && !!githubToken
  const bootstrapScript = options.local ? undefined : generateBootstrapScript(profile)

  if (options.local) {
    return {
      profile,
      generated,
      overlayDir,
      local: true,
      useGitClone,
      githubToken,
      bootstrapScript,
    }
  }

  return {
    profile,
    generated,
    overlayDir,
    local: false,
    useGitClone,
    githubToken,
    bootstrapScript,
    runSpec: {
      projectDir: overlayDir,
      ...(useGitClone
        ? { repoCloneUrl: profile.githubRemote, githubToken }
        : { repoSourceDir: profile.path }),
      sandboxRepoRoot: SANDBOX_PROJECT_ROOT,
      workspaceRoot: SANDBOX_WORKSPACE_ROOT,
      gitRoot: SANDBOX_PROJECT_ROOT,
      bootstrapScript,
      sourceLabel: `takeover (${path.basename(profile.path)})`,
      storySync: options.storySync,
      hooks: buildTakeoverExecutionHooks(profile, generated.intent),
    },
  }
}

export async function executePreparedTakeoverLaunch(
  launch: PreparedTakeoverLaunch,
  opts: RunOptions,
  bindings: HostRunBindings = {},
): Promise<void> {
  if (launch.local) {
    await runLocal(launch.profile, launch.generated, launch.overlayDir, opts)
    return
  }

  await runGoal(launch.generated.goal, opts, launch.runSpec, bindings)
}
