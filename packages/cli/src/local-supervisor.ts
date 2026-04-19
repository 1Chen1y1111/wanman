import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { AgentMatrixConfig } from '@wanman/core'
import type { AgentRuntime } from '@wanman/core'
import type { ExecutionBackend } from './execution-backend.js'
import { createLocalRuntimeClient } from './runtime-client.js'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

export interface LocalSupervisorOptions {
  configPath: string
  workspaceRoot: string
  gitRoot: string
  sharedSkillsDir: string
  homeRoot: string
  goal?: string
  runtime?: AgentRuntime
  codexModel?: string
  codexReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
}

export interface LocalSupervisorHandle extends ExecutionBackend {
  kind: 'local'
  port: number
  child: ChildProcess
}

function createLocalLogBuffer(maxLines = 200): {
  readSince: (cursor: number) => { lines: string[]; cursor: number }
  pushChunk: (chunk: Buffer | string) => void
} {
  const lines: string[] = []
  let total = 0
  let pending = ''

  const pushLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    lines.push(trimmed)
    total += 1
    if (lines.length > maxLines) lines.splice(0, lines.length - maxLines)
  }

  return {
    readSince(cursor) {
      const retainedStart = Math.max(total - lines.length, 0)
      const startIndex = cursor <= retainedStart ? 0 : cursor - retainedStart
      return {
        lines: lines.slice(startIndex),
        cursor: total,
      }
    },
    pushChunk(chunk) {
      pending += chunk.toString()
      const parts = pending.split(/\r?\n/)
      pending = parts.pop() ?? ''
      for (const part of parts) pushLine(part)
    },
  }
}

async function pickAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to determine an available local port')))
        return
      }
      const { port } = address
      server.close(error => {
        if (error) reject(error)
        else resolve(port)
      })
    })
  })
}

function syncHomeEntry(source: string, target: string): void {
  if (!fs.existsSync(source)) return
  fs.rmSync(target, { recursive: true, force: true })
  const stat = fs.statSync(source)
  fs.symlinkSync(source, target, stat.isDirectory() ? 'dir' : 'file')
}

function resolveRuntimeEntrypoint(): string {
  const candidates = [
    path.resolve(MODULE_DIR, '../../runtime/dist/entrypoint.js'),
    path.resolve(MODULE_DIR, '../runtime/dist/entrypoint.js'),
    '/opt/wanman/runtime/entrypoint.js',
  ]
  const entrypoint = candidates.find(candidate => fs.existsSync(candidate))
  if (!entrypoint) {
    throw new Error('cannot find runtime entrypoint.js. Run `pnpm -F @wanman/runtime build` first.')
  }
  return entrypoint
}

function installSharedSkills(sharedSkillsDir: string, agentHome: string): void {
  for (const target of [`${agentHome}/.claude/skills`, `${agentHome}/.codex/skills`]) {
    for (const skillDir of fs.readdirSync(sharedSkillsDir)) {
      const src = path.join(sharedSkillsDir, skillDir)
      if (!fs.statSync(src).isDirectory()) continue
      const dst = path.join(target, skillDir)
      fs.mkdirSync(dst, { recursive: true })
      for (const file of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, file), path.join(dst, file))
      }
    }
  }
}

function createHomeLayout(homeRoot: string): { agentHome: string; binDir: string } {
  const home = process.env['HOME'] || '/root'
  const binDir = path.join(homeRoot, 'bin')
  const agentHome = path.join(homeRoot, 'home')
  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(agentHome, { recursive: true })

  const cliHostEntrypoint = path.resolve(MODULE_DIR, '../dist/wanman.js')
  if (fs.existsSync(cliHostEntrypoint)) {
    const wanmanWrapper = path.join(binDir, 'wanman')
    fs.writeFileSync(
      wanmanWrapper,
      `#!/usr/bin/env bash\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cliHostEntrypoint)} "$@"\n`,
    )
    fs.chmodSync(wanmanWrapper, 0o755)
  }

  const pnpmWrapper = path.join(binDir, 'pnpm')
  fs.writeFileSync(pnpmWrapper, '#!/usr/bin/env bash\nexec corepack pnpm "$@"\n')
  fs.chmodSync(pnpmWrapper, 0o755)

  for (const entry of ['.codex', '.claude', '.config', '.gitconfig', '.git-credentials', '.ssh']) {
    syncHomeEntry(path.join(home, entry), path.join(agentHome, entry))
  }
  fs.writeFileSync(path.join(agentHome, '.bash_profile'), `export PATH=${JSON.stringify(binDir)}:$PATH\n`)

  return { agentHome, binDir }
}

function buildLocalSupervisorEnv(
  baseEnv: NodeJS.ProcessEnv,
  opts: LocalSupervisorOptions,
  agentHome: string,
  binDir: string,
  port: number,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv }

  // Do not leak outer Codex session controls into the nested local supervisor.
  delete env['CODEX_CI']
  delete env['CODEX_SANDBOX_NETWORK_DISABLED']
  delete env['CODEX_THREAD_ID']

  return {
    ...env,
    HOME: agentHome,
    PATH: `${binDir}:${baseEnv['PATH'] || ''}`,
    WANMAN_URL: `http://127.0.0.1:${port}`,
    WANMAN_CONFIG: opts.configPath,
    WANMAN_WORKSPACE: opts.workspaceRoot,
    WANMAN_SKILLS: opts.workspaceRoot,
    WANMAN_GIT_ROOT: opts.gitRoot,
    WANMAN_SHARED_SKILLS: opts.sharedSkillsDir,
    ...(opts.goal ? { WANMAN_GOAL: opts.goal } : {}),
    ...(opts.runtime ? { WANMAN_RUNTIME: opts.runtime } : {}),
    ...(opts.codexModel ? { WANMAN_CODEX_MODEL: opts.codexModel } : {}),
    ...(opts.codexReasoningEffort ? { WANMAN_CODEX_REASONING_EFFORT: opts.codexReasoningEffort } : {}),
  }
}

export async function startLocalSupervisor(opts: LocalSupervisorOptions): Promise<LocalSupervisorHandle> {
  const port = await pickAvailablePort()
  const config = JSON.parse(fs.readFileSync(opts.configPath, 'utf-8')) as AgentMatrixConfig
  config.port = port
  fs.writeFileSync(opts.configPath, JSON.stringify(config, null, 2))

  const entrypoint = resolveRuntimeEntrypoint()
  const { agentHome, binDir } = createHomeLayout(opts.homeRoot)
  installSharedSkills(opts.sharedSkillsDir, agentHome)

  const logBuffer = createLocalLogBuffer()
  const child = spawn('node', [entrypoint], {
    cwd: opts.gitRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildLocalSupervisorEnv(process.env, opts, agentHome, binDir, port),
  })
  child.stdout?.on('data', chunk => logBuffer.pushChunk(chunk))
  child.stderr?.on('data', chunk => logBuffer.pushChunk(chunk))

  return {
    kind: 'local',
    port,
    endpoint: `http://127.0.0.1:${port}`,
    runtime: createLocalRuntimeClient(port),
    child,
    entrypoint,
    async readLogs(cursor) {
      return logBuffer.readSince(cursor)
    },
    attachSignalForwarding() {
      const forward = (signal: NodeJS.Signals) => {
        child.kill(signal)
      }
      process.on('SIGINT', forward)
      process.on('SIGTERM', forward)
      return () => {
        process.off('SIGINT', forward)
        process.off('SIGTERM', forward)
      }
    },
    async stop(force = false) {
      child.kill('SIGTERM')
      await new Promise(resolve => setTimeout(resolve, force ? 100 : 1000))
      if (child.exitCode === null) child.kill('SIGKILL')
    },
    async waitForExit() {
      await new Promise<void>((resolve, reject) => {
        if (child.exitCode !== null) {
          if (child.exitCode !== 0) reject(new Error(`Supervisor exited with code ${child.exitCode}`))
          else resolve()
          return
        }
        child.on('error', reject)
        child.on('close', code => {
          if (code !== null && code !== 0) reject(new Error(`Supervisor exited with code ${code}`))
          else resolve()
        })
      })
    },
  }
}
