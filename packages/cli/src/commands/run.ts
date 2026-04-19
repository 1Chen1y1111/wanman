import { createDefaultRunOptions, type RunOptions } from '@wanman/host-sdk'
import type { AgentRuntime } from '@wanman/core'
import { detectProjectDir as detectRunProjectDir, runGoal } from '../run-host.js'
import {
  type ExecutionBackend,
  type ExecutionContext,
  type ExecutionHooks,
  type HealthAgent,
  type PollExecutionContext,
  type ProjectRunSpec,
  type TaskInfo,
} from '../execution-session.js'

export type {
  ExecutionBackend,
  ExecutionContext,
  ExecutionHooks,
  HealthAgent,
  PollExecutionContext,
  ProjectRunSpec,
  TaskInfo,
}

// ── Arg parsing ──

/** @internal exported for testing */
export function parseOptions(args: string[]): { goal: string; opts: RunOptions } {
  const goal = args[0]!
  const opts = createDefaultRunOptions()

  const normalizeCodexReasoningEffort = (value: string): NonNullable<RunOptions['codexReasoningEffort']> => {
    switch (value.trim().toLowerCase()) {
      case 'low':
      case 'fast':
        return 'low'
      case 'medium':
      case 'balanced':
        return 'medium'
      case 'high':
      case 'deep':
        return 'high'
      case 'xhigh':
      case 'max':
        return 'xhigh'
      default:
        throw new Error(`Invalid codex effort/speed: ${value}. Use low|medium|high|xhigh or fast|balanced|deep|max.`)
    }
  }

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--loops': opts.loops = parseInt(args[++i]!, 10); break
      case '--poll': opts.pollInterval = parseInt(args[++i]!, 10); break
      case '--runtime': opts.runtime = (args[++i] === 'codex' ? 'codex' : 'claude') satisfies AgentRuntime; break
      case '--codex-model': opts.codexModel = args[++i]; break
      case '--codex-effort': opts.codexReasoningEffort = normalizeCodexReasoningEffort(args[++i]!); break
      case '--codex-speed': opts.codexReasoningEffort = normalizeCodexReasoningEffort(args[++i]!); break
      case '--config': opts.configPath = args[++i]; break
      case '--worker-url': opts.workerUrl = args[++i]; break
      case '--worker-model': opts.workerModel = args[++i]; break
      case '--worker-key': opts.workerKey = args[++i]!; break
      case '--no-brain': opts.noBrain = true; break
      case '--keep': opts.keep = true; break
      case '--output': opts.output = args[++i]!; break
      case '--clone-from': opts.cloneFrom = args[++i]; break
      case '--local': opts.local = true; break
      case '--project-dir': opts.projectDir = args[++i]; break
      case '--infinite': opts.infinite = true; break
      case '--error-limit': opts.errorLimit = parseInt(args[++i]!, 10); break
    }
  }
  if (opts.infinite) opts.loops = Infinity
  return { goal, opts }
}

export function detectProjectDir(dir = process.cwd()): string | null {
  return detectRunProjectDir(dir)
}

const RUN_HELP = `wanman run — Goal-Driven Agent Runner

Usage:
  wanman run <goal> [options]

If the current directory contains agents.json, it will be used as the
project directory. Agent skills are loaded from agents/{name}/CLAUDE.md
and shared skills from skills/{name}/SKILL.md.

Options:
  --loops <n>           Max CEO loops (default: 100)
  --infinite            Run indefinitely (exit via Ctrl+C or error limit)
  --error-limit <n>     Max consecutive error loops before exit (default: 20)
  --poll <seconds>      Poll interval (default: 15)
  --runtime <name>      Agent runtime: claude (default) or codex
  --codex-model <name>  Codex model override for local/sandbox codex runs
  --codex-effort <lvl>  Codex reasoning effort: low|medium|high|xhigh
  --codex-speed <lvl>   Alias for --codex-effort using fast|balanced|deep|max
  --project-dir <path>  Working directory to run against (defaults to current dir)
  --worker-url <url>    Worker LLM API endpoint (hybrid mode)
  --worker-model <m>    Worker model name
  --worker-key <key>    Worker API key (default: lmstudio)
  --no-brain            Disable db9 brain
  --local               Run locally with host runtime instead of sandbox
  --keep                Keep the execution backend alive on exit
  --output <path>       Download deliverables to (default: ./deliverables)
  --clone-from <id>     Clone existing box (inherit credentials)

Project directory structure:
  agents.json                Agent role definitions
  agents/{name}/CLAUDE.md    Per-agent skill files
  skills/{name}/SKILL.md     Shared skills (optional)
  products.json              Product catalog (optional)

Environment:
  SANDBANK_URL          Sandbank URL (e.g. http://localhost:3140)
  SANDBANK_API_KEY      Sandbank API key
  SANDBANK_CLONE_FROM   Box ID to clone from
  DB9_TOKEN             db9 API token for brain
  ANTHROPIC_BASE_URL    Override CEO LLM endpoint
  WANMAN_RUNTIME        Override agent runtime (claude or codex)
`

export async function runWithGoal(goal: string, opts: RunOptions, spec: ProjectRunSpec = {}): Promise<void> {
  await runGoal(goal, opts, spec)
}

export async function runCommand(args: string[]): Promise<void> {
  if (!args[0] || args[0] === '--help' || args[0] === '-h') {
    console.log(RUN_HELP)
    process.exit(args[0] ? 0 : 1)
  }

  const { goal, opts } = parseOptions(args)
  await runWithGoal(goal, opts)
}
