/**
 * `wanman takeover` - Take over an existing git repo with autonomous agents.
 *
 * This command intentionally stays thin:
 * - parse takeover-specific CLI args
 * - scan the project and build the initial agent config
 * - choose local vs sandbox execution backend
 * - delegate project analysis and orchestration details to dedicated modules
 */

import * as fs from 'node:fs'
import { execSync } from 'node:child_process'
import type { AgentRuntime, TakeoverLaunchInputRecord, TakeoverRepoAuth } from '@wanman/core'
import {
  type GeneratedAgentConfig,
  type ProjectDocument,
  type ProjectIntent,
  type ProjectProfile,
  buildProjectIntent,
  collectProjectDocs,
  detectCI,
  detectCodeRoots,
  detectFrameworks,
  detectGitHubRemote,
  detectLanguages,
  detectPackageManagers,
  detectPackageScripts,
  detectTests,
  generateAgentConfig,
  inferGoal,
  materializeTakeoverProject,
  scanProject,
  scanReadme,
} from '../takeover-project.js'
import {
  hasLocalProgress,
  materializeLocalTakeoverProject,
  parseLocalGitStatus,
  planLocalDynamicClone,
} from '../takeover-local.js'
import { createEnvBackedWanmanHostSdk } from '../host-sdk.js'
import { createCliLaunchSdk, resolveCliLaunchApiOptions } from '../launch-api-client.js'
import { listUnsupportedRunControlPlaneFlags, parseOptions } from './run.js'

export type {
  GeneratedAgentConfig,
  ProjectDocument,
  ProjectIntent,
  ProjectProfile,
}

export {
  buildProjectIntent,
  collectProjectDocs,
  detectCI,
  detectCodeRoots,
  detectFrameworks,
  detectGitHubRemote,
  detectLanguages,
  detectPackageManagers,
  detectPackageScripts,
  detectTests,
  generateAgentConfig,
  hasLocalProgress,
  inferGoal,
  materializeLocalTakeoverProject,
  materializeTakeoverProject,
  parseLocalGitStatus,
  planLocalDynamicClone,
  scanProject,
  scanReadme,
}

const TAKEOVER_HELP = `wanman takeover - Take over an existing git repo

Usage:
  wanman takeover <path> [options]

Options:
  --goal <text>         Override auto-inferred long-running mission
  --runtime <name>      Agent runtime: claude (default) or codex
  --codex-model <name>  Codex model override for local/sandbox codex runs
  --codex-effort <lvl>  Codex reasoning effort: low|medium|high|xhigh
  --codex-speed <lvl>   Alias for --codex-effort using fast|balanced|deep|max
  --github-token <tok>  GitHub token (default: GITHUB_TOKEN env or gh auth token)
  --repo-auth <mode>    Remote repo access: public (default) or runner-env
  --local               Run locally without sandbox (supervisor in current env)
  --dry-run             Scan and generate takeover overlay without launching
  --infinite            Run in infinite mode (default: true)
  --loops <n>           Run finite loops instead of infinite mode
  --poll <seconds>      Poll interval
  --keep                Keep sandbox alive on exit
  --output <path>       Deliverables directory
  --clone-from <id>     Clone an existing sandbox
  --no-brain            Disable db9 brain
`

function splitTakeoverArgs(args: string[]): {
  projectPath: string
  goalOverride?: string
  runtime: AgentRuntime
  githubToken?: string
  repoAuth: TakeoverRepoAuth
  local: boolean
  dryRun: boolean
  runArgs: string[]
} {
  const projectPath = args[0]!
  const runArgs: string[] = []
  let goalOverride: string | undefined
  let runtime: AgentRuntime = 'claude'
  let githubToken: string | undefined
  let repoAuth: TakeoverRepoAuth = 'public'
  let local = false
  let dryRun = false

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '--goal':
        goalOverride = args[++i]
        break
      case '--runtime':
        runtime = args[++i] === 'codex' ? 'codex' : 'claude'
        break
      case '--github-token':
        githubToken = args[++i]
        break
      case '--repo-auth': {
        const value = args[++i]?.trim().toLowerCase().replace('-', '_')
        if (value !== 'public' && value !== 'runner_env') {
          throw new Error(`Invalid --repo-auth value: ${args[i]}. Use public or runner-env.`)
        }
        repoAuth = value
        break
      }
      case '--local':
        local = true
        break
      case '--dry-run':
        dryRun = true
        break
      default:
        runArgs.push(arg!)
        if (arg && arg.startsWith('--') && !['--infinite', '--keep', '--no-brain'].includes(arg)) {
          const next = args[i + 1]
          if (next && !next.startsWith('--')) {
            runArgs.push(next)
            i++
          }
        }
        break
    }
  }

  return { projectPath, goalOverride, runtime, githubToken, repoAuth, local, dryRun, runArgs }
}

function hasExplicitRunMode(runArgs: string[]): boolean {
  return runArgs.includes('--infinite') || runArgs.includes('--loops')
}

function printProjectSummary(profile: ProjectProfile, generated: GeneratedAgentConfig): void {
  console.log('\n  Project Profile:')
  console.log(`    Languages:   ${profile.languages.join(', ') || 'none'}`)
  console.log(`    Frameworks:  ${profile.frameworks.join(', ') || 'none'}`)
  console.log(`    CI/CD:       ${profile.ci.join(', ') || 'none'}`)
  console.log(`    Tests:       ${profile.testFrameworks.join(', ') || 'none'}`)
  console.log(`    Issues:      ${profile.issueTracker}`)
  console.log(`    README:      ${profile.hasReadme ? 'yes' : 'no'}`)
  console.log(`    Docs:        ${profile.hasDocs ? 'yes' : 'no'}`)
  console.log(`    Code Roots:  ${(profile.codeRoots ?? []).join(', ') || 'repo root'}`)

  console.log('\n  Project Intent:')
  console.log(`    Name:        ${generated.intent.projectName}`)
  console.log(`    Summary:     ${generated.intent.summary.slice(0, 120)}`)
  console.log(`    Docs:        ${generated.intent.canonicalDocs.map(doc => doc.path).join(', ') || 'none'}`)
  console.log('    Themes:')
  for (const theme of generated.intent.strategicThemes) {
    console.log(`      - ${theme}`)
  }
}

interface TakeoverGitContext {
  activeBranch?: string
  branchAhead: number
  hasUpstream: boolean
  modifiedFiles: string[]
}

function readTakeoverGitContext(projectPath: string): TakeoverGitContext {
  try {
    const raw = execSync('git status --porcelain=v2 --branch --untracked-files=all', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const parsed = parseLocalGitStatus(raw)
    return {
      activeBranch: parsed.activeBranch,
      branchAhead: parsed.branchAhead,
      hasUpstream: parsed.hasUpstream,
      modifiedFiles: parsed.modifiedFiles,
    }
  } catch {
    return {
      activeBranch: undefined,
      branchAhead: 0,
      hasUpstream: false,
      modifiedFiles: [],
    }
  }
}

export function buildTakeoverLaunchInput(
  profile: ProjectProfile,
  runtime: AgentRuntime,
  opts: ReturnType<typeof parseOptions>['opts'],
  repoAuth: TakeoverRepoAuth,
  goalOverride?: string,
  repoRef?: string | null,
): TakeoverLaunchInputRecord {
  if (!profile.githubRemote) {
    throw new Error('A GitHub remote is required to queue takeover through the control plane')
  }

  return {
    repo_url: profile.githubRemote,
    repo_ref: repoRef ?? null,
    goal_override: goalOverride ?? null,
    repo_auth: repoAuth,
    mode: 'sandbox',
    runtime,
    loops: Number.isFinite(opts.loops) ? opts.loops : null,
    infinite: opts.infinite,
    poll_interval: opts.pollInterval,
    keep: opts.keep,
    enable_brain: !opts.noBrain,
    output: opts.output,
    codex_model: opts.codexModel ?? null,
    codex_reasoning_effort: opts.codexReasoningEffort ?? null,
  }
}

export function listUnsupportedTakeoverControlPlaneReasons(
  profile: ProjectProfile,
  opts: ReturnType<typeof parseOptions>['opts'],
  git: TakeoverGitContext,
  explicitGithubToken?: string,
): string[] {
  const reasons = [...listUnsupportedRunControlPlaneFlags(opts)]

  if (!profile.githubRemote) reasons.push('missing GitHub remote')
  if (git.modifiedFiles.length > 0) reasons.push('local uncommitted changes')
  if (git.branchAhead > 0) reasons.push('local commits ahead of origin')
  if (explicitGithubToken) reasons.push('--github-token')

  return reasons
}

export async function queueTakeoverCommand(
  profile: ProjectProfile,
  runtime: AgentRuntime,
  opts: ReturnType<typeof parseOptions>['opts'],
  repoAuth: TakeoverRepoAuth,
  goalOverride?: string,
  explicitGithubToken?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const apiOptions = resolveCliLaunchApiOptions(env)
  if (!apiOptions) return false

  const git = readTakeoverGitContext(profile.path)
  const reasons = listUnsupportedTakeoverControlPlaneReasons(profile, opts, git, explicitGithubToken)
  if (reasons.length > 0) {
    console.warn(
      `Bypassing launch control plane for takeover because these conditions require direct host execution: ${reasons.join(', ')}`,
    )
    return false
  }

  const launch = await createCliLaunchSdk(apiOptions).createTakeoverLaunch(
    buildTakeoverLaunchInput(profile, runtime, opts, repoAuth, goalOverride, git.activeBranch ?? null),
  )
  console.log(`Queued takeover launch ${launch.id} via control plane (${launch.status}).`)
  console.log(`Use "wanman launch watch ${launch.id}" to follow execution.`)
  return true
}

export async function takeoverCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(TAKEOVER_HELP)
    return
  }

  const { projectPath, goalOverride, runtime, githubToken: explicitToken, repoAuth, local, dryRun, runArgs } = splitTakeoverArgs(args)
  if (!fs.existsSync(projectPath)) {
    console.error(`Error: path does not exist: ${projectPath}`)
    process.exit(1)
  }

  console.log(`\n  Scanning ${projectPath}...`)
  const previewProfile = scanProject(projectPath)
  const previewGenerated = generateAgentConfig(previewProfile, goalOverride, runtime)
  const previewGoal = previewGenerated.goal
  const normalizedRunArgs = hasExplicitRunMode(runArgs) ? runArgs : ['--infinite', ...runArgs]
  const { opts } = parseOptions([previewGoal, ...normalizedRunArgs])
  printProjectSummary(previewProfile, previewGenerated)

  if (!local && !dryRun) {
    if (await queueTakeoverCommand(previewProfile, runtime, opts, repoAuth, goalOverride, explicitToken)) {
      return
    }
  }

  const sdk = createEnvBackedWanmanHostSdk()
  const launch = sdk.prepareTakeover({
    projectPath,
    goalOverride,
    runtime,
    githubToken: explicitToken,
    local,
    enableBrain: !opts.noBrain,
  })

  console.log(`\n  Mode:    ${local ? 'local (no sandbox)' : 'sandbox'}`)
  console.log(`  Runtime: ${runtime}`)
  console.log(`  Git:     ${local ? 'local repo' : launch.useGitClone ? `gh clone (${launch.profile.githubRemote})` : 'tar upload (no GitHub remote or token)'}`)
  if (launch.bootstrapScript) {
    console.log(`  Bootstrap: ${launch.bootstrapScript.slice(0, 100)}${launch.bootstrapScript.length > 100 ? '...' : ''}`)
  }
  console.log(`  Goal: ${launch.generated.goal}`)
  console.log('\n  Agents:')
  for (const agent of launch.generated.agents) {
    const status = agent.enabled ? '✅' : '❌'
    console.log(`    ${status} ${agent.name} (${agent.lifecycle}) - ${agent.reason}`)
  }
  console.log(`\n  Overlay: ${launch.overlayDir}`)

  if (dryRun) {
    console.log(`\n  Dry run complete. Generated takeover overlay at ${launch.overlayDir}`)
    return
  }

  await sdk.executePreparedTakeover(launch, opts)
}
