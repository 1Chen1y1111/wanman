/**
 * `wanman takeover` - Take over an existing git repo with autonomous agents.
 *
 * This command intentionally stays thin:
 * - parse takeover-specific CLI args
 * - scan the project and build the initial agent config
 * - dispatch into the local supervisor path (the only path supported in OSS)
 * - delegate project analysis details to dedicated modules
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AgentRuntime } from '@wanman/core'
import {
  type GeneratedAgentConfig,
  type ProjectDocument,
  type ProjectIntent,
  type ProjectProfile,
  SANDBOX_PROJECT_ROOT,
  SANDBOX_WORKSPACE_ROOT,
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
  runLocal,
} from '../takeover-local.js'
import { buildTakeoverExecutionHooks } from '../takeover-hooks.js'
import { resolveGithubToken } from './sandbox-git.js'
import { runGoal } from '../run-host.js'
import { generateBootstrapScript } from './runtime-bootstrap.js'
import type { ProjectRunSpec } from '../execution-session.js'
import { parseOptions } from './run.js'

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
  local: boolean
  dryRun: boolean
  runArgs: string[]
} {
  const projectPath = args[0]!
  const runArgs: string[] = []
  let goalOverride: string | undefined
  let runtime: AgentRuntime = 'claude'
  let githubToken: string | undefined
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

  return { projectPath, goalOverride, runtime, githubToken, local, dryRun, runArgs }
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

export async function takeoverCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(TAKEOVER_HELP)
    return
  }

  const { projectPath, goalOverride, runtime, githubToken: explicitToken, local, dryRun, runArgs } = splitTakeoverArgs(args)
  if (!fs.existsSync(projectPath)) {
    console.error(`Error: path does not exist: ${projectPath}`)
    process.exit(1)
  }

  console.log(`\n  Scanning ${projectPath}...`)
  const profile = scanProject(projectPath)
  const generated = generateAgentConfig(profile, goalOverride, runtime)
  const previewGoal = generated.goal
  const normalizedRunArgs = hasExplicitRunMode(runArgs) ? runArgs : ['--infinite', ...runArgs]
  const { opts } = parseOptions([previewGoal, ...normalizedRunArgs])
  printProjectSummary(profile, generated)

  // Force infinite mode for takeover (parseOptions already sets loops=Infinity when --infinite)
  opts.infinite = true
  opts.loops = Infinity

  const overlayDir = local
    ? materializeLocalTakeoverProject(profile, generated, { enableBrain: !opts.noBrain })
    : materializeTakeoverProject(profile, generated, { enableBrain: !opts.noBrain })

  const githubToken = profile.githubRemote ? resolveGithubToken(explicitToken) : undefined
  const useGitClone = !!profile.githubRemote && !!githubToken
  const bootstrapScript = local ? undefined : generateBootstrapScript(profile)

  console.log(`\n  Mode:    ${local ? 'local (no sandbox)' : 'sandbox'}`)
  console.log(`  Runtime: ${runtime}`)
  console.log(`  Git:     ${local ? 'local repo' : useGitClone ? `gh clone (${profile.githubRemote})` : 'tar upload (no GitHub remote or token)'}`)
  if (bootstrapScript) {
    console.log(`  Bootstrap: ${bootstrapScript.slice(0, 100)}${bootstrapScript.length > 100 ? '...' : ''}`)
  }
  console.log(`  Goal: ${generated.goal}`)
  console.log('\n  Agents:')
  for (const agent of generated.agents) {
    const status = agent.enabled ? '✅' : '❌'
    console.log(`    ${status} ${agent.name} (${agent.lifecycle}) - ${agent.reason}`)
  }
  console.log(`\n  Overlay: ${overlayDir}`)

  if (dryRun) {
    console.log(`\n  Dry run complete. Generated takeover overlay at ${overlayDir}`)
    return
  }

  if (local) {
    await runLocal(profile, generated, overlayDir, opts)
    return
  }

  const runSpec: ProjectRunSpec = {
    projectDir: overlayDir,
    ...(useGitClone
      ? { repoCloneUrl: profile.githubRemote, githubToken }
      : { repoSourceDir: profile.path }),
    sandboxRepoRoot: SANDBOX_PROJECT_ROOT,
    workspaceRoot: SANDBOX_WORKSPACE_ROOT,
    gitRoot: SANDBOX_PROJECT_ROOT,
    bootstrapScript,
    sourceLabel: `takeover (${path.basename(profile.path)})`,
    hooks: buildTakeoverExecutionHooks(profile, generated.intent),
  }

  await runGoal(generated.goal, opts, runSpec)
}
