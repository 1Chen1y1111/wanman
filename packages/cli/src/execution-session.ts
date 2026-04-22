import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import type { Sandbox } from '@sandbank.dev/core'
import type { ProjectRunSpec as BaseProjectRunSpec, RunOptions } from '@wanman/host-sdk'
import type { AgentRuntime } from '@wanman/core'
import { type ExecutionBackend } from './execution-backend.js'
import { Heartbeat, LoopEventBus, LoopLogger } from './loop-observability.js'
import {
  type HealthAgent,
  type RuntimeArtifact,
  type RuntimeClient,
  type TaskInfo,
} from './runtime-client.js'
import {
  codexStatusIndicatesAuthenticated,
  startCodexDeviceLogin,
} from './sandbox-auth.js'
import {
  createRunLaunchPlan,
  createRunSessionPlan,
  createSandboxRuntimeEnv,
} from './run-orchestrator.js'
import { runLocalExecution } from './run-local-executor.js'
import { runSandboxExecution } from './run-sandbox-executor.js'
import { renderDashboard, type DashboardState } from './tui/dashboard.js'
import { countTransitions, classifyLoop, type LoopSnapshot, type LoopClassification } from './loop-classifier.js'

export type { ExecutionBackend } from './execution-backend.js'
export type { HealthAgent, RuntimeClient, TaskInfo } from './runtime-client.js'
export type { RunOptions } from '@wanman/host-sdk'

function loadEnvFile(root: string, env: NodeJS.ProcessEnv = process.env): void {
  const envPath = path.join(root, '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!env[key]) env[key] = val
  }
}

export type ProjectRunSpec = BaseProjectRunSpec<ExecutionHooks>

export interface RunExecutionBindings {
  hostEnv?: NodeJS.ProcessEnv
}

export interface ExecutionContext {
  backend: ExecutionBackend
  sandbox?: Sandbox
  runtime: RuntimeClient
  goal: string
  opts: RunOptions
  spec: ProjectRunSpec
  runId: string
  workspaceRoot: string
  sandboxRepoRoot?: string
  brainName?: string
}

export interface PollExecutionContext extends ExecutionContext {
  loop: number
  startTime: number
  agents: HealthAgent[]
  tasks: TaskInfo[]
  logs: string[]
}

export interface ExecutionHooks {
  afterHealthy?(ctx: ExecutionContext): Promise<void>
  afterPoll?(ctx: PollExecutionContext): Promise<void>
  shouldStop?(ctx: PollExecutionContext): Promise<boolean>
}

interface EmbeddedAssets {
  ENTRYPOINT_JS: string
  CLI_JS: string
  AGENT_CONFIGS: Record<string, string>
  AGENT_SKILLS: Record<string, string>
  SHARED_SKILLS: Record<string, string>
  PRODUCTS_JSON: string | null
}

let embeddedAssets: EmbeddedAssets | null = null

async function getEmbeddedAssets(): Promise<EmbeddedAssets | null> {
  if (embeddedAssets !== null) return embeddedAssets
  try {
    embeddedAssets = await import('./embedded-assets.js')
    return embeddedAssets
  } catch {
    return null
  }
}

function findProjectRoot(): string | null {
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function isStale(distFile: string, srcDir: string): boolean {
  if (!fs.existsSync(distFile)) return true
  try {
    const files = execSync(
      `find '${srcDir}' -name '*.ts' -not -path '*/node_modules/*' -not -path '*/__tests__/*' -newer '${distFile}'`,
      { encoding: 'utf-8' },
    ).trim()
    return files.length > 0
  } catch {
    return true
  }
}

function buildIfNeeded(root: string): void {
  const runtimeDist = path.join(root, 'packages/runtime/dist/entrypoint.js')
  const runtimeSrc = path.join(root, 'packages/runtime/src')
  const coreSrc = path.join(root, 'packages/core/src')
  const cliDist = path.join(root, 'packages/cli/dist/index.js')
  const cliSrc = path.join(root, 'packages/cli/src')

  if (isStale(runtimeDist, runtimeSrc) || isStale(runtimeDist, coreSrc)) {
    console.log('  [build] Building @wanman/runtime...')
    execSync('pnpm --filter @wanman/runtime build', { cwd: root, stdio: 'inherit' })
  }
  if (isStale(cliDist, cliSrc) || isStale(cliDist, coreSrc)) {
    console.log('  [build] Building @wanman/cli...')
    execSync('pnpm --filter @wanman/cli build', { cwd: root, stdio: 'inherit' })
  }
}

async function writeFileLarge(sandbox: Sandbox, filePath: string, content: string): Promise<void> {
  const chunkSize = 64 * 1024
  const bytes = Buffer.from(content, 'utf-8')
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  if (dir) await sandbox.exec(`mkdir -p '${dir}'`)

  const firstChunk = bytes.subarray(0, chunkSize).toString('base64')
  await sandbox.exec(`printf '%s' '${firstChunk}' | base64 -d > '${filePath}'`)

  for (let offset = chunkSize; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize).toString('base64')
    await sandbox.exec(`printf '%s' '${chunk}' | base64 -d >> '${filePath}'`)
  }
}

async function uploadBundle(sandbox: Sandbox, root: string, configPath: string): Promise<void> {
  await sandbox.exec('mkdir -p /opt/wanman/runtime /opt/wanman/skills /workspace/agents')

  console.log('  [bundle] Uploading entrypoint.js...')
  const entrypoint = fs.readFileSync(path.join(root, 'packages/runtime/dist/entrypoint.js'), 'utf-8')
  await writeFileLarge(sandbox, '/opt/wanman/runtime/entrypoint.js', entrypoint)

  const sqliteCheck = await sandbox.exec('test -d /opt/wanman/runtime/node_modules/better-sqlite3 && echo OK || echo MISSING')
  if (sqliteCheck.stdout.trim() !== 'OK') {
    console.log('  [bundle] Installing native dependencies...')
    await sandbox.exec('cd /opt/wanman/runtime && npm init -y > /dev/null 2>&1 && npm install better-sqlite3', { timeout: 600_000 })
  }

  console.log('  [bundle] Uploading wanman CLI...')
  const cli = fs.readFileSync(path.join(root, 'packages/cli/dist/index.js'), 'utf-8')
  await writeFileLarge(sandbox, '/usr/local/bin/wanman', cli)
  await sandbox.exec('chmod +x /usr/local/bin/wanman')

  console.log('  [bundle] Uploading config...')
  const config = fs.readFileSync(configPath, 'utf-8')
  await sandbox.writeFile('/opt/wanman/agents.json', config)

  const skillsDir = path.join(root, 'packages/core/agents')
  if (fs.existsSync(skillsDir)) {
    for (const agentDir of fs.readdirSync(skillsDir)) {
      const claudeMd = path.join(skillsDir, agentDir, 'CLAUDE.md')
      if (fs.existsSync(claudeMd)) {
        await sandbox.exec(`mkdir -p /opt/wanman/skills/${agentDir}`)
        await sandbox.writeFile(`/opt/wanman/skills/${agentDir}/CLAUDE.md`, fs.readFileSync(claudeMd, 'utf-8'))
      }
    }
  }

  const sharedSkillsDir = path.join(root, 'packages/core/skills')
  if (fs.existsSync(sharedSkillsDir)) {
    await sandbox.exec('mkdir -p /opt/wanman/shared-skills')
    for (const skillDir of fs.readdirSync(sharedSkillsDir)) {
      const skillPath = path.join(sharedSkillsDir, skillDir)
      if (!fs.statSync(skillPath).isDirectory()) continue
      const skillMd = path.join(skillPath, 'SKILL.md')
      if (fs.existsSync(skillMd)) {
        await sandbox.exec(`mkdir -p /opt/wanman/shared-skills/${skillDir}`)
        await sandbox.writeFile(`/opt/wanman/shared-skills/${skillDir}/SKILL.md`, fs.readFileSync(skillMd, 'utf-8'))
      }
    }
  }

  const productsPath = path.join(root, 'apps/container/products.json')
  if (fs.existsSync(productsPath)) {
    await sandbox.writeFile('/opt/wanman/products.json', fs.readFileSync(productsPath, 'utf-8'))
  }
}

async function uploadBundleStandalone(sandbox: Sandbox, assets: EmbeddedAssets, configName: string): Promise<void> {
  await sandbox.exec('mkdir -p /opt/wanman/runtime /opt/wanman/skills /workspace/agents')

  console.log('  [bundle] Uploading entrypoint.js (embedded)...')
  await writeFileLarge(sandbox, '/opt/wanman/runtime/entrypoint.js', assets.ENTRYPOINT_JS)

  const sqliteCheck = await sandbox.exec('test -d /opt/wanman/runtime/node_modules/better-sqlite3 && echo OK || echo MISSING')
  if (sqliteCheck.stdout.trim() !== 'OK') {
    console.log('  [bundle] Installing native dependencies...')
    await sandbox.exec('cd /opt/wanman/runtime && npm init -y > /dev/null 2>&1 && npm install better-sqlite3', { timeout: 600_000 })
  }

  console.log('  [bundle] Uploading wanman CLI (embedded)...')
  await writeFileLarge(sandbox, '/usr/local/bin/wanman', assets.CLI_JS)
  await sandbox.exec('chmod +x /usr/local/bin/wanman')

  console.log('  [bundle] Uploading config...')
  const config = assets.AGENT_CONFIGS[configName]
  if (!config) throw new Error(`Embedded config '${configName}' not found. Available: ${Object.keys(assets.AGENT_CONFIGS).join(', ')}`)
  await sandbox.writeFile('/opt/wanman/agents.json', config)

  for (const [name, content] of Object.entries(assets.AGENT_SKILLS)) {
    await sandbox.exec(`mkdir -p /opt/wanman/skills/${name}`)
    await sandbox.writeFile(`/opt/wanman/skills/${name}/CLAUDE.md`, content)
  }

  if (Object.keys(assets.SHARED_SKILLS).length > 0) {
    await sandbox.exec('mkdir -p /opt/wanman/shared-skills')
    for (const [name, content] of Object.entries(assets.SHARED_SKILLS)) {
      await sandbox.exec(`mkdir -p /opt/wanman/shared-skills/${name}`)
      await sandbox.writeFile(`/opt/wanman/shared-skills/${name}/SKILL.md`, content)
    }
  }

  if (assets.PRODUCTS_JSON) {
    await sandbox.writeFile('/opt/wanman/products.json', assets.PRODUCTS_JSON)
  }
}

async function uploadProjectBundle(
  sandbox: Sandbox,
  projectDir: string,
  runtime: { root: string } | { embedded: EmbeddedAssets },
  workspaceRoot = '/workspace/agents',
): Promise<void> {
  await sandbox.exec(`mkdir -p /opt/wanman/runtime /opt/wanman/skills '${workspaceRoot}'`)

  if ('root' in runtime) {
    console.log('  [bundle] Uploading entrypoint.js...')
    const entrypoint = fs.readFileSync(path.join(runtime.root, 'packages/runtime/dist/entrypoint.js'), 'utf-8')
    await writeFileLarge(sandbox, '/opt/wanman/runtime/entrypoint.js', entrypoint)
    console.log('  [bundle] Uploading wanman CLI...')
    const cli = fs.readFileSync(path.join(runtime.root, 'packages/cli/dist/index.js'), 'utf-8')
    await writeFileLarge(sandbox, '/usr/local/bin/wanman', cli)
  } else {
    console.log('  [bundle] Uploading entrypoint.js (embedded)...')
    await writeFileLarge(sandbox, '/opt/wanman/runtime/entrypoint.js', runtime.embedded.ENTRYPOINT_JS)
    console.log('  [bundle] Uploading wanman CLI (embedded)...')
    await writeFileLarge(sandbox, '/usr/local/bin/wanman', runtime.embedded.CLI_JS)
  }
  await sandbox.exec('chmod +x /usr/local/bin/wanman')

  const sqliteCheck = await sandbox.exec('test -d /opt/wanman/runtime/node_modules/better-sqlite3 && echo OK || echo MISSING')
  if (sqliteCheck.stdout.trim() !== 'OK') {
    console.log('  [bundle] Installing native dependencies...')
    await sandbox.exec('cd /opt/wanman/runtime && npm init -y > /dev/null 2>&1 && npm install better-sqlite3', { timeout: 600_000 })
  }

  console.log('  [bundle] Uploading config (project)...')
  const config = fs.readFileSync(path.join(projectDir, 'agents.json'), 'utf-8')
  await sandbox.writeFile('/opt/wanman/agents.json', config)

  const agentsDir = path.join(projectDir, 'agents')
  if (fs.existsSync(agentsDir)) {
    for (const agentDir of fs.readdirSync(agentsDir)) {
      const claudeMd = path.join(agentsDir, agentDir, 'CLAUDE.md')
      if (fs.existsSync(claudeMd)) {
        await sandbox.exec(`mkdir -p /opt/wanman/skills/${agentDir}`)
        await sandbox.writeFile(`/opt/wanman/skills/${agentDir}/CLAUDE.md`, fs.readFileSync(claudeMd, 'utf-8'))
      }
    }
  }

  await sandbox.exec('mkdir -p /opt/wanman/shared-skills')
  if ('root' in runtime) {
    const builtinSkillsDir = path.join(runtime.root, 'packages/core/skills')
    if (fs.existsSync(builtinSkillsDir)) {
      for (const skillDir of fs.readdirSync(builtinSkillsDir)) {
        const skillPath = path.join(builtinSkillsDir, skillDir)
        if (!fs.statSync(skillPath).isDirectory()) continue
        const skillMd = path.join(skillPath, 'SKILL.md')
        if (fs.existsSync(skillMd)) {
          await sandbox.exec(`mkdir -p /opt/wanman/shared-skills/${skillDir}`)
          await sandbox.writeFile(`/opt/wanman/shared-skills/${skillDir}/SKILL.md`, fs.readFileSync(skillMd, 'utf-8'))
        }
      }
    }
  } else {
    for (const [name, content] of Object.entries(runtime.embedded.SHARED_SKILLS)) {
      await sandbox.exec(`mkdir -p /opt/wanman/shared-skills/${name}`)
      await sandbox.writeFile(`/opt/wanman/shared-skills/${name}/SKILL.md`, content)
    }
  }

  const projectSkillsDir = path.join(projectDir, 'skills')
  if (fs.existsSync(projectSkillsDir)) {
    for (const skillDir of fs.readdirSync(projectSkillsDir)) {
      const skillPath = path.join(projectSkillsDir, skillDir)
      if (!fs.statSync(skillPath).isDirectory()) continue
      const skillMd = path.join(skillPath, 'SKILL.md')
      if (fs.existsSync(skillMd)) {
        await sandbox.exec(`mkdir -p /opt/wanman/shared-skills/${skillDir}`)
        await sandbox.writeFile(`/opt/wanman/shared-skills/${skillDir}/SKILL.md`, fs.readFileSync(skillMd, 'utf-8'))
      }
    }
  }

  const productsPath = path.join(projectDir, 'products.json')
  if (fs.existsSync(productsPath)) {
    await sandbox.writeFile('/opt/wanman/products.json', fs.readFileSync(productsPath, 'utf-8'))
  }
}

const REPO_ARCHIVE_EXCLUDES = [
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.pnpm-store',
  '.venv',
  'venv',
  '__pycache__',
]

function createRepoSnapshotArchive(repoDir: string): string {
  const tempDir = fs.mkdtempSync(path.join(process.env['TMPDIR'] || '/tmp', 'wanman-takeover-archive-'))
  const archivePath = path.join(tempDir, 'repo.tgz')
  const excludes = REPO_ARCHIVE_EXCLUDES
    .map(pattern => `--exclude=${JSON.stringify(pattern)}`)
    .join(' ')

  execSync(
    `COPYFILE_DISABLE=1 tar -czf ${JSON.stringify(archivePath)} ${excludes} -C ${JSON.stringify(repoDir)} .`,
    { stdio: 'pipe' },
  )

  return archivePath
}

async function uploadRepoSnapshot(sandbox: Sandbox, repoDir: string, sandboxRepoRoot: string): Promise<void> {
  console.log(`  [bundle] Uploading repo snapshot from ${repoDir}...`)
  const archivePath = createRepoSnapshotArchive(repoDir)
  const remoteB64 = '/tmp/wanman-repo.tgz.b64'
  const remoteTgz = '/tmp/wanman-repo.tgz'

  try {
    const b64 = fs.readFileSync(archivePath).toString('base64')
    await writeFileLarge(sandbox, remoteB64, b64)
    await sandbox.exec(
      `mkdir -p '${sandboxRepoRoot}'`
      + ` && base64 -d '${remoteB64}' > '${remoteTgz}'`
      + ` && tar -xzf '${remoteTgz}' -C '${sandboxRepoRoot}'`
      + ` && rm -f '${remoteB64}' '${remoteTgz}'`,
      { timeout: 600_000 },
    )
  } finally {
    fs.rmSync(path.dirname(archivePath), { recursive: true, force: true })
  }
}

interface LocalRunLayout {
  baseDir: string
  configPath: string
  workspaceRoot: string
  sharedSkillsDir: string
  gitRoot: string
  cleanup(): void
}

/** @internal exported for testing */
export function localizeRunConfigForHost(
  configText: string,
  baseDir: string,
  workspaceRoot: string,
  gitRoot: string,
): string {
  const config = JSON.parse(configText) as Record<string, unknown>
  config['dbPath'] = path.join(baseDir, 'wanman.db')
  config['workspaceRoot'] = workspaceRoot
  config['gitRoot'] = gitRoot
  return JSON.stringify(config, null, 2)
}

function copyDirectoryContents(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) return
  fs.mkdirSync(targetDir, { recursive: true })
  for (const entry of fs.readdirSync(sourceDir)) {
    fs.cpSync(path.join(sourceDir, entry), path.join(targetDir, entry), {
      recursive: true,
      force: true,
      dereference: false,
    })
  }
}

function copyAgentWorkspace(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
    return
  }
  copyDirectoryContents(sourceDir, targetDir)
}

function writeEmbeddedAgentWorkspace(assets: EmbeddedAssets, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true })
  for (const [name, content] of Object.entries(assets.AGENT_SKILLS)) {
    const agentDir = path.join(targetDir, name)
    fs.mkdirSync(agentDir, { recursive: true })
    fs.writeFileSync(path.join(agentDir, 'CLAUDE.md'), content)
  }
}

function writeEmbeddedSharedSkills(assets: EmbeddedAssets, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true })
  for (const [name, content] of Object.entries(assets.SHARED_SKILLS)) {
    const skillDir = path.join(targetDir, name)
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content)
  }
}

function materializeLocalRunLayout(params: {
  runId: string
  outputDir: string
  projectDir?: string
  root?: string | null
  embedded?: EmbeddedAssets | null
  configText: string
  gitRoot?: string
}): LocalRunLayout {
  if (!params.root && !params.embedded) {
    throw new Error('Cannot materialize local run assets without monorepo sources or embedded assets.')
  }

  const baseDir = path.resolve(params.outputDir, '.wanman-local', params.runId)
  fs.rmSync(baseDir, { recursive: true, force: true })
  fs.mkdirSync(baseDir, { recursive: true })

  const configPath = path.join(baseDir, 'agents.json')
  const workspaceRoot = path.join(baseDir, 'agents')
  const sharedSkillsDir = path.join(baseDir, 'shared-skills')
  const gitRoot = path.resolve(params.gitRoot ?? params.projectDir ?? params.root ?? process.cwd())
  const localizedConfigText = localizeRunConfigForHost(params.configText, baseDir, workspaceRoot, gitRoot)

  fs.writeFileSync(configPath, localizedConfigText)
  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.mkdirSync(sharedSkillsDir, { recursive: true })

  if (params.projectDir) {
    copyAgentWorkspace(path.join(params.projectDir, 'agents'), workspaceRoot)
    if (params.root) {
      copyDirectoryContents(path.join(params.root, 'packages/core/skills'), sharedSkillsDir)
    } else if (params.embedded) {
      writeEmbeddedSharedSkills(params.embedded, sharedSkillsDir)
    }
    copyDirectoryContents(path.join(params.projectDir, 'skills'), sharedSkillsDir)
  } else if (params.root) {
    copyAgentWorkspace(path.join(params.root, 'packages/core/agents'), workspaceRoot)
    copyDirectoryContents(path.join(params.root, 'packages/core/skills'), sharedSkillsDir)
  } else if (params.embedded) {
    writeEmbeddedAgentWorkspace(params.embedded, workspaceRoot)
    writeEmbeddedSharedSkills(params.embedded, sharedSkillsDir)
  }

  return {
    baseDir,
    configPath,
    workspaceRoot,
    sharedSkillsDir,
    gitRoot,
    cleanup() {
      fs.rmSync(baseDir, { recursive: true, force: true })
    },
  }
}

function getDb9Token(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env['DB9_TOKEN']) return env['DB9_TOKEN']
  try {
    return execSync('db9 token show 2>/dev/null', { encoding: 'utf-8' }).trim() || undefined
  } catch {
    return undefined
  }
}

const CRED_CACHE_DIR = path.join(process.env['HOME'] ?? '/root', '.cache', 'wanman')
const CLAUDE_CRED_CACHE_FILE = path.join(CRED_CACHE_DIR, 'credentials.json')
const CLAUDE_JSON_CACHE = path.join(CRED_CACHE_DIR, 'claude.json')
const CODEX_AUTH_CACHE_FILE = path.join(CRED_CACHE_DIR, 'codex-auth.json')
const CRED_MIN_LIFETIME_MS = 30 * 60 * 1000

function loadCachedClaudeCredentials(): { accessToken: string; refreshToken: string; expiresAt: number } | null {
  try {
    if (!fs.existsSync(CLAUDE_CRED_CACHE_FILE)) return null
    const data = JSON.parse(fs.readFileSync(CLAUDE_CRED_CACHE_FILE, 'utf-8'))
    const remaining = data.claudeAiOauth.expiresAt - Date.now()
    if (remaining < CRED_MIN_LIFETIME_MS) return null
    return data.claudeAiOauth
  } catch {
    return null
  }
}

function loadCachedCodexAuth(): string | null {
  try {
    if (!fs.existsSync(CODEX_AUTH_CACHE_FILE)) return null
    const raw = fs.readFileSync(CODEX_AUTH_CACHE_FILE, 'utf-8')
    const data = JSON.parse(raw) as { tokens?: { access_token?: string } }
    return data.tokens?.access_token ? raw : null
  } catch {
    return null
  }
}

async function setupClaudeAuth(sandbox: Sandbox, home: string, useThirdPartyApi: boolean): Promise<void> {
  const hasExistingAuth = await sandbox.exec(`test -f '${home}/.claude/.credentials.json' && test -f '${home}/.claude.json'`)
  if (hasExistingAuth.exitCode === 0) {
    console.log('  [auth] Existing Claude credentials detected, skipping auth')
    return
  }

  if (useThirdPartyApi) {
    const claudeVer = (await sandbox.exec('claude --version 2>&1')).stdout.trim()
    const claudeJson = JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: claudeVer })
    await sandbox.exec(`mkdir -p ${home}/.claude`)
    await sandbox.writeFile(`${home}/.claude.json`, claudeJson)
    console.log('  [auth] Claude third-party API mode - no OAuth needed')
    return
  }

  const cached = loadCachedClaudeCredentials()
  if (cached) {
    await sandbox.exec(`mkdir -p ${home}/.claude`)
    await sandbox.writeFile(`${home}/.claude/.credentials.json`, fs.readFileSync(CLAUDE_CRED_CACHE_FILE, 'utf-8'))
    const claudeVer = (await sandbox.exec('claude --version 2>&1')).stdout.trim()
    let claudeJson: string
    if (fs.existsSync(CLAUDE_JSON_CACHE)) {
      claudeJson = fs.readFileSync(CLAUDE_JSON_CACHE, 'utf-8')
      try {
        const parsed = JSON.parse(claudeJson)
        parsed.lastOnboardingVersion = claudeVer
        claudeJson = JSON.stringify(parsed)
      } catch {
        // use as-is
      }
    } else {
      claudeJson = JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: claudeVer })
    }
    await sandbox.writeFile(`${home}/.claude.json`, claudeJson)
    console.log('  [auth] Using cached Claude credentials')
    return
  }

  const { startClaudeLogin } = await import('@sandbank.dev/core')
  console.log('\n  [auth] Starting OAuth login...')
  const { url, sendCode, waitForCredentials } = await startClaudeLogin(sandbox, { installCommand: 'true' })

  try { execSync(`open ${JSON.stringify(url)}`) } catch { /* ignore */ }
  console.log(`\n  ${url}\n`)

  const codeFile = '/tmp/wanman-auth-code'
  fs.rmSync(codeFile, { force: true })
  console.log(`  Waiting for auth code... echo "CODE" > ${codeFile}`)

  let authCode = ''
  const start = Date.now()
  while (Date.now() - start < 600_000) {
    try {
      if (fs.existsSync(codeFile)) {
        authCode = fs.readFileSync(codeFile, 'utf-8').trim()
        if (authCode) break
      }
    } catch {
      // retry
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!authCode) throw new Error('Auth code timeout (10 min)')

  await sendCode(authCode)
  await waitForCredentials(120_000)
  await sandbox.exec('screen -S claude-login -X quit 2>/dev/null || true')

  const claudeVer = (await sandbox.exec('claude --version 2>&1')).stdout.trim()
  const claudeJson = JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: claudeVer })
  await sandbox.writeFile(`${home}/.claude.json`, claudeJson)

  try {
    const credsResult = await sandbox.exec(`cat ${home}/.claude/.credentials.json`)
    if (credsResult.exitCode === 0 && credsResult.stdout.trim()) {
      fs.mkdirSync(CRED_CACHE_DIR, { recursive: true })
      fs.writeFileSync(CLAUDE_CRED_CACHE_FILE, credsResult.stdout, { mode: 0o600 })
      fs.writeFileSync(CLAUDE_JSON_CACHE, claudeJson, { mode: 0o600 })
    }
  } catch {
    // non-fatal
  }

  console.log('  [auth] Claude authenticated!')
}

async function codexStatusAuthenticated(sandbox: Sandbox): Promise<boolean> {
  const result = await sandbox.exec('codex login status 2>&1 || true')
  return codexStatusIndicatesAuthenticated(`${result.stdout}\n${result.stderr}`)
}

async function setupCodexAuth(sandbox: Sandbox, home: string): Promise<void> {
  const codexBinary = await sandbox.exec('command -v codex >/dev/null && echo OK || echo MISSING')
  if (codexBinary.stdout.trim() !== 'OK') {
    throw new Error('Codex CLI not installed in sandbox image')
  }

  const hasExistingAuth = await sandbox.exec(`test -s '${home}/.codex/auth.json' && echo OK || echo MISSING`)
  if (hasExistingAuth.stdout.trim() === 'OK' && await codexStatusAuthenticated(sandbox)) {
    console.log('  [auth] Existing Codex credentials detected, skipping auth')
    return
  }

  const cachedAuth = loadCachedCodexAuth()
  if (cachedAuth) {
    await sandbox.exec(`mkdir -p '${home}/.codex'`)
    await sandbox.writeFile(`${home}/.codex/auth.json`, cachedAuth)
    if (await codexStatusAuthenticated(sandbox)) {
      console.log('  [auth] Using cached Codex credentials')
      return
    }
    await sandbox.exec(`rm -f '${home}/.codex/auth.json'`)
    console.log('  [auth] Cached Codex credentials were rejected, re-running device login')
  }

  console.log('\n  [auth] Starting Codex device login...')
  const login = await startCodexDeviceLogin(sandbox, home)
  try {
    try { execSync(`open ${JSON.stringify(login.url)}`) } catch { /* ignore */ }
    console.log(`\n  ${login.url}\n`)
    console.log(`  One-time code: ${login.code}`)
    console.log('  Complete authorization in your browser. Waiting for sandbox credentials...')

    const authJson = await login.waitForCredentials()
    fs.mkdirSync(CRED_CACHE_DIR, { recursive: true })
    fs.writeFileSync(CODEX_AUTH_CACHE_FILE, authJson, { mode: 0o600 })
  } finally {
    await login.cleanup().catch(() => {})
  }

  console.log('  [auth] Codex authenticated!')
}

async function setupAuth(
  sandbox: Sandbox,
  opts: { useThirdPartyApi: boolean; runtimes: AgentRuntime[] },
): Promise<void> {
  const home = (await sandbox.exec('echo $HOME')).stdout.trim() || '/root'
  for (const runtime of opts.runtimes) {
    if (runtime === 'codex') {
      await setupCodexAuth(sandbox, home)
    } else {
      await setupClaudeAuth(sandbox, home, opts.useThirdPartyApi)
    }
  }
}

function selectConfig(root: string, opts: RunOptions, db9Token?: string): string {
  if (opts.configPath) return path.resolve(opts.configPath)
  const hybrid = path.join(root, 'apps/container/agents.e2e-hybrid.json')
  const local = path.join(root, 'apps/container/agents.local.json')
  const e2e = path.join(root, 'apps/container/agents.e2e.json')

  if (opts.workerUrl && fs.existsSync(hybrid)) return hybrid
  if (db9Token && fs.existsSync(local)) return local
  return e2e
}

function selectConfigName(opts: RunOptions, db9Token?: string): string {
  if (opts.workerUrl) return 'agents.e2e-hybrid.json'
  if (db9Token) return 'agents.local.json'
  return 'agents.e2e.json'
}

function getSelectedConfigText(
  projectDir: string | null | undefined,
  root: string | null,
  embedded: EmbeddedAssets | null,
  opts: RunOptions,
  db9Token?: string,
): string {
  if (projectDir) {
    return fs.readFileSync(path.join(projectDir, 'agents.json'), 'utf-8')
  }

  if (embedded) {
    const configName = selectConfigName(opts, db9Token)
    const config = embedded.AGENT_CONFIGS[configName]
    if (!config) {
      throw new Error(`Embedded config '${configName}' not found. Available: ${Object.keys(embedded.AGENT_CONFIGS).join(', ')}`)
    }
    return config
  }

  return fs.readFileSync(selectConfig(root!, opts, db9Token), 'utf-8')
}

function getRunOutputDir(outputDir: string, brainName?: string): string {
  const dirName = brainName || `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
  return path.resolve(outputDir, dirName)
}

function exportBrainArtifacts(localDir: string, brainName?: string): void {
  if (!brainName) return
  try {
    const out = execSync(
      `db9 db sql $(db9 db list --json 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));const f=d.find(x=>x.name==='${brainName}');if(f)process.stdout.write(f.id)") -q "SELECT * FROM artifacts ORDER BY created_at" --json 2>/dev/null`,
      { encoding: 'utf-8', timeout: 15_000 },
    )
    const artifactsPath = path.join(localDir, 'brain-artifacts.json')
    fs.writeFileSync(artifactsPath, out)
    const count = JSON.parse(out).length
    console.log(`  Exported ${count} brain artifacts → brain-artifacts.json`)
  } catch {
    // db might not exist
  }
}

async function exportTasks(runtime: RuntimeClient, localDir: string): Promise<void> {
  try {
    const tasks = await runtime.listTasks()
    if (tasks.length > 0) {
      const tasksPath = path.join(localDir, 'tasks.json')
      fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2))
      console.log(`  Saved ${tasks.length} tasks → tasks.json`)
    }
  } catch {
    // supervisor might be down
  }
}

async function downloadDeliverables(
  sandbox: Sandbox,
  runtime: RuntimeClient,
  outputDir: string,
  brainName?: string,
  workspaceRoot = '/workspace/agents',
): Promise<void> {
  console.log('\n  Downloading deliverables...')

  const checkResult = await sandbox.exec(`find '${workspaceRoot}' -type f 2>/dev/null | head -1`)
  if (!checkResult.stdout.trim()) {
    console.log('  No deliverable files found.')
    return
  }

  const dirName = brainName || `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
  const localDir = path.resolve(outputDir, dirName)
  fs.mkdirSync(localDir, { recursive: true })

  try {
    const archiveStream = await sandbox.downloadArchive(workspaceRoot)
    const tarPath = path.join(localDir, '_archive.tar')
    const chunks: Uint8Array[] = []
    const reader = archiveStream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const tarData = Buffer.concat(chunks)
    fs.writeFileSync(tarPath, tarData)
    execSync(`tar xf '${tarPath}' -C '${localDir}'`, { stdio: 'pipe' })
    fs.rmSync(tarPath)
    const fileCount = execSync(`find '${localDir}' -type f | wc -l`, { encoding: 'utf-8' }).trim()
    console.log(`  Downloaded ${fileCount} files → ${localDir}`)
  } catch {
    console.log('  Archive download failed, falling back to per-file...')
    const findResult = await sandbox.exec(
      `find '${workspaceRoot}' -type f \\( -path '*/output/*' -o -name 'CLAUDE.md' \\) 2>/dev/null | sort`,
    )
    const files = findResult.stdout.trim().split('\n').filter(Boolean)
    let downloaded = 0
    for (const remotePath of files) {
      const prefix = workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const relative = remotePath.replace(new RegExp(`^${prefix}/`), '')
      const localPath = path.join(localDir, relative)
      try {
        fs.mkdirSync(path.dirname(localPath), { recursive: true })
        const content = await sandbox.readFile(remotePath)
        fs.writeFileSync(localPath, content)
        downloaded++
      } catch {
        console.log(`  [skip] ${relative}`)
      }
    }
    console.log(`  Downloaded ${downloaded}/${files.length} files → ${localDir}`)
  }

  exportBrainArtifacts(localDir, brainName)
  await exportTasks(runtime, localDir)
}

async function downloadLocalDeliverables(
  runtime: RuntimeClient,
  outputDir: string,
  workspaceRoot: string,
  brainName?: string,
): Promise<void> {
  console.log('\n  Downloading deliverables...')
  const localDir = getRunOutputDir(outputDir, brainName)
  const hasFiles = fs.existsSync(workspaceRoot)
    && execSync(`find '${workspaceRoot}' -type f 2>/dev/null | head -1`, { encoding: 'utf-8' }).trim()

  if (!hasFiles) {
    console.log('  No deliverable files found.')
    return
  }

  fs.rmSync(localDir, { recursive: true, force: true })
  fs.cpSync(workspaceRoot, localDir, {
    recursive: true,
    force: true,
    dereference: false,
  })
  const fileCount = execSync(`find '${localDir}' -type f | wc -l`, { encoding: 'utf-8' }).trim()
  console.log(`  Downloaded ${fileCount} files → ${localDir}`)
  exportBrainArtifacts(localDir, brainName)
  await exportTasks(runtime, localDir)
}

async function downloadRepoPatch(
  sandbox: Sandbox,
  outputDir: string,
  repoRoot: string,
  brainName?: string,
): Promise<void> {
  const dirName = brainName || `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
  const localDir = path.resolve(outputDir, dirName)
  fs.mkdirSync(localDir, { recursive: true })

  const status = await sandbox.exec(`git -C '${repoRoot}' status --short`)
  if (!status.stdout.trim()) {
    return
  }

  const diff = await sandbox.exec(`git -C '${repoRoot}' diff --binary`)
  const cachedDiff = await sandbox.exec(`git -C '${repoRoot}' diff --cached --binary`)
  fs.writeFileSync(path.join(localDir, 'repo-status.txt'), status.stdout)
  if (diff.stdout.trim()) {
    fs.writeFileSync(path.join(localDir, 'repo.patch'), diff.stdout)
  }
  if (cachedDiff.stdout.trim()) {
    fs.writeFileSync(path.join(localDir, 'repo-staged.patch'), cachedDiff.stdout)
  }
  console.log(`  Exported repo patch → ${localDir}`)
}

async function downloadLocalRepoPatch(
  outputDir: string,
  repoRoot: string,
  brainName?: string,
): Promise<void> {
  const localDir = getRunOutputDir(outputDir, brainName)
  fs.mkdirSync(localDir, { recursive: true })

  const status = execSync(`git -C '${repoRoot}' status --short`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (!status.trim()) {
    return
  }

  const diff = execSync(`git -C '${repoRoot}' diff --binary`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
  const cachedDiff = execSync(`git -C '${repoRoot}' diff --cached --binary`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
  fs.writeFileSync(path.join(localDir, 'repo-status.txt'), status)
  if (diff.trim()) {
    fs.writeFileSync(path.join(localDir, 'repo.patch'), diff)
  }
  if (cachedDiff.trim()) {
    fs.writeFileSync(path.join(localDir, 'repo-staged.patch'), cachedDiff)
  }
  console.log(`  Exported repo patch → ${localDir}`)
}

async function recordRunInBrain(runId: string, goal: string, brainName?: string): Promise<void> {
  if (!brainName) return
  try {
    const dbId = execSync(
      `db9 --json db list 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));const f=d.find(x=>x.name==='${brainName}');if(f)process.stdout.write(f.id)"`,
      { encoding: 'utf-8', timeout: 10_000 },
    ).trim()
    if (dbId) {
      execSync(
        `db9 db sql ${dbId} -q "INSERT INTO runs (id, goal, config) VALUES ('${runId}', '${goal.replace(/'/g, "''")}', '{}') ON CONFLICT (id) DO NOTHING" 2>/dev/null`,
        { timeout: 10_000 },
      )
    }
  } catch {
    // best-effort
  }
}

export function buildRunKickoffPayload(goal: string): string {
  return [
    `Run kickoff for goal: ${goal}.`,
    'If the backlog is empty, decompose the goal immediately into the first 3-5 concrete tasks and assign them to the right agents.',
    'Use `wanman task create` right away, and include `--path` or `--pattern` for code/docs work to keep scopes clean.',
    'Do not wait for another prompt before creating the initial backlog.',
  ].join(' ')
}

async function maybeSendRunKickoff(runtime: RuntimeClient, goal: string, from = 'run-bootstrap'): Promise<boolean> {
  const tasks = await runtime.listTasks().catch(() => [])
  if (tasks.length > 0) return false
  await runtime.sendMessage({
    from,
    to: 'ceo',
    type: 'message',
    priority: 'steer',
    payload: buildRunKickoffPayload(goal),
  }).catch(() => undefined)
  return true
}

async function observeExecutionBackend(params: {
  backend: ExecutionBackend
  goal: string
  opts: RunOptions
  spec: ProjectRunSpec
  runId: string
  workspaceRoot: string
  sandboxRepoRoot?: string
  brainName?: string
  hooks?: ExecutionHooks
  shouldStop?: () => boolean
}): Promise<{ finalLoop: number; finalTasks: TaskInfo[] }> {
  const { backend, goal, opts, spec, runId, workspaceRoot, sandboxRepoRoot, brainName, hooks } = params
  const runtime = backend.runtime

  if (!hooks?.afterHealthy) {
    await maybeSendRunKickoff(runtime, goal)
  }

  if (hooks?.afterHealthy) {
    await hooks.afterHealthy({
      backend,
      sandbox: backend.sandbox,
      runtime,
      goal,
      opts,
      spec,
      runId,
      workspaceRoot,
      sandboxRepoRoot,
      brainName,
    })
  }

  const loopEventsPath = path.join(opts.output, 'loop-events.ndjson')
  fs.mkdirSync(opts.output, { recursive: true })

  const eventBus = new LoopEventBus(runId)
  const loopLogger = new LoopLogger({
    ndjsonPath: loopEventsPath,
    bufferCapacity: 1000,
  })
  loopLogger.attach(eventBus)

  const heartbeatPath = path.join(opts.output, '.wanman', 'heartbeat.json')
  const heartbeat = new Heartbeat(heartbeatPath, runId)
  heartbeat.start(10_000)

  await recordRunInBrain(runId, goal, brainName)

  const startTime = Date.now()
  let logCursor = 0
  const logBuffer: string[] = []
  const maxLogLines = 20
  const doneObserveLoops = 5
  let doneStreak = 0
  let errorStreak = 0
  let prevTasks: TaskInfo[] = []
  let finalLoop = 0

  for (let loop = 1; loop <= opts.loops; loop++) {
    finalLoop = loop
    if (params.shouldStop?.()) break

    let agents: HealthAgent[] = []
    try {
      const health = await runtime.getHealth()
      agents = health.agents
    } catch {
      // ignore
    }

    const tasks = await runtime.listTasks().catch(() => [])
    const nextLogs = await backend.readLogs(logCursor)
    logCursor = nextLogs.cursor
    for (const line of nextLogs.lines) {
      logBuffer.push(line)
      if (logBuffer.length > maxLogLines * 2) logBuffer.splice(0, logBuffer.length - maxLogLines)
    }

    let artifactSummary: RuntimeArtifact[] = []
    if (brainName) {
      try {
        const out = execSync(
          `db9 db sql $(db9 db list --json 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));const f=d.find(x=>x.name==='${brainName}');if(f)process.stdout.write(f.id)") -q "SELECT agent, kind, count(*) as cnt FROM artifacts GROUP BY agent, kind ORDER BY agent" --json 2>/dev/null`,
          { encoding: 'utf-8', timeout: 10_000 },
        )
        artifactSummary = JSON.parse(out)
      } catch {
        // db might not exist yet
      }
    }

    const state: DashboardState = {
      goal,
      loop,
      maxLoops: opts.loops,
      elapsed: Date.now() - startTime,
      brainName,
      agents,
      tasks,
      logs: logBuffer.slice(-maxLogLines),
      artifacts: artifactSummary,
    }
    renderDashboard(state)

    if (hooks?.afterPoll || hooks?.shouldStop) {
      const pollContext: PollExecutionContext = {
        backend,
        sandbox: backend.sandbox,
        runtime,
        goal,
        opts,
        spec,
        runId,
        workspaceRoot,
        sandboxRepoRoot,
        brainName,
        loop,
        startTime,
        agents,
        tasks,
        logs: logBuffer.slice(-maxLogLines),
      }
      if (hooks.afterPoll) {
        await hooks.afterPoll(pollContext)
      }
      if (hooks.shouldStop && await hooks.shouldStop(pollContext)) {
        console.log('\n  Hook requested stop. Exiting.')
        break
      }
    }

    eventBus.tick()
    heartbeat.tick()
    loopLogger.updateTaskSnapshot(tasks.length, tasks.filter(task => task.status === 'done').length)

    const transitions = countTransitions(prevTasks, tasks)
    if (transitions > 0) {
      for (const task of tasks) {
        const previous = prevTasks.find(item => item.id === task.id)
        if (previous && previous.status !== task.status) {
          eventBus.emit({
            type: 'task.transition', runId, loop: eventBus.currentLoop,
            taskId: parseInt(task.id, 10) || 0,
            assignee: task.assignee, from: previous.status, to: task.status,
            timestamp: new Date().toISOString(),
          })
        }
      }
      for (const task of tasks) {
        if (!prevTasks.find(item => item.id === task.id)) {
          eventBus.emit({
            type: 'task.transition', runId, loop: eventBus.currentLoop,
            taskId: parseInt(task.id, 10) || 0,
            assignee: task.assignee, from: '(new)', to: task.status,
            timestamp: new Date().toISOString(),
          })
        }
      }
    }

    for (const agent of agents) {
      if (agent.state === 'running') {
        eventBus.emit({
          type: 'agent.spawned', runId, loop: eventBus.currentLoop,
          agent: agent.name,
          lifecycle: agent.lifecycle as '24/7' | 'on-demand',
          trigger: loop === 1 ? 'startup' : 'message',
          timestamp: new Date().toISOString(),
        })
      }
    }

    const classified = eventBus.classify(agents.map(agent => ({
      name: agent.name,
      state: agent.state,
      lifecycle: agent.lifecycle,
    })))
    const classification = classified.classification
    const reasons = classified.reasons

    const snapshot: LoopSnapshot = {
      loop,
      timestamp: new Date().toISOString(),
      elapsed: Date.now() - startTime,
      classification: classification as LoopClassification,
      reasons,
      tasks: tasks.map(task => ({ id: task.id, title: task.title, status: task.status, assignee: task.assignee })),
      taskTransitions: transitions,
      agents: agents.map(agent => ({ name: agent.name, state: agent.state, lifecycle: agent.lifecycle })),
    }
    try { fs.appendFileSync(loopEventsPath + '.legacy', JSON.stringify(snapshot) + '\n') } catch { /* best-effort */ }
    prevTasks = tasks

    const doneCount = tasks.filter(task => task.status === 'done').length
    if (!opts.infinite && classification === 'idle' && tasks.length > 0 && doneCount === tasks.length && loop > 10) {
      doneStreak++
      const remaining = doneObserveLoops - doneStreak
      if (remaining > 0) {
        console.log(`\n  All ${doneCount} tasks done. Observing ${remaining} more loops...`)
      } else {
        console.log(`\n  All ${doneCount} tasks done for ${doneObserveLoops} consecutive polls. Exiting.`)
        break
      }
    } else {
      doneStreak = 0
    }

    if (opts.infinite && classification === 'error') {
      errorStreak++
      if (errorStreak >= opts.errorLimit) {
        console.log(`\n  ${errorStreak} consecutive error loops. Exiting infinite mode.`)
        break
      }
    } else if (classification !== 'error') {
      errorStreak = 0
    }

    if (loop < opts.loops) {
      await new Promise(resolve => setTimeout(resolve, opts.pollInterval * 1000))
    }
  }

  heartbeat.stop()
  loopLogger.detach(eventBus)
  eventBus.removeAllListeners()

  console.log('\n  Run complete.')

  try {
    const lines = fs.readFileSync(path.join(opts.output, 'loop-events.ndjson'), 'utf-8').trim().split('\n')
    const classifiedEvents = lines
      .map(line => { try { return JSON.parse(line) } catch { return null } })
      .filter(event => event?.type === 'loop.classified')
    const counts: Record<string, number> = { productive: 0, idle: 0, blocked: 0, backlog_stuck: 0, error: 0 }
    for (const event of classifiedEvents) {
      counts[event.classification] = (counts[event.classification] ?? 0) + 1
    }
    const total = classifiedEvents.length
    const rate = total > 0 ? Math.round(((counts.productive ?? 0) / total) * 100) : 0
    console.log(`  Loop summary: ${total} loops, ${counts.productive} productive (${rate}%), ${counts.idle} idle, ${counts.blocked} blocked`)
  } catch {
    // best-effort
  }

  const finalTasks = await runtime.listTasks().catch(() => [])
  const tasksCreated = finalTasks.length
  const tasksDone = finalTasks.filter(task => task.status === 'done').length
  const completionRate = tasksCreated > 0 ? Math.round((tasksDone / tasksCreated) * 100) : 0
  console.log(`  Tasks: ${tasksDone}/${tasksCreated} done (${completionRate}% completion rate)`)
  console.log(`  NDJSON: ${path.join(opts.output, 'loop-events.ndjson')}`)
  if (fs.existsSync(path.join(opts.output, 'results.tsv'))) {
    console.log(`  results.tsv: ${path.join(opts.output, 'results.tsv')}`)
  }
  if (fs.existsSync(path.join(opts.output, '.wanman', 'heartbeat.json'))) {
    console.log(`  Heartbeat: ${path.join(opts.output, '.wanman', 'heartbeat.json')}`)
  }

  try {
    const meta = {
      goal,
      maxLoops: opts.loops,
      actualLoops: finalLoop,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date().toISOString(),
      brainName: brainName ?? null,
    }
    fs.writeFileSync(path.join(opts.output, 'meta.json'), JSON.stringify(meta, null, 2))
  } catch {
    // best-effort
  }

  return { finalLoop, finalTasks }
}

export async function runExecutionSession(
  goal: string,
  opts: RunOptions,
  spec: ProjectRunSpec = {},
  bindings: RunExecutionBindings = {},
): Promise<void> {
  const hostEnv = bindings.hostEnv ?? process.env
  const launchPlan = createRunLaunchPlan(opts, spec)
  const {
    requestedProjectDir,
    projectDir,
    repoSourceDir,
    sandboxRepoRoot,
    sandboxGitRoot,
    localGitRoot,
    workspaceRoot,
  } = launchPlan
  const hooks = spec.hooks

  const root = findProjectRoot()
  const embedded = root ? null : await getEmbeddedAssets()
  const standalone = !root && !!embedded

  if (root) loadEnvFile(root, hostEnv)
  if (!projectDir && !root && !embedded) {
    throw new Error(
      'Cannot find agents.json in current directory, monorepo root, or embedded assets.\n'
      + 'Either cd into a project directory with agents.json, run from the monorepo, or use the standalone binary.',
    )
  }

  const db9Token = opts.noBrain ? undefined : getDb9Token(hostEnv)
  let configName: string
  if (projectDir) configName = 'agents.json (project)'
  else if (standalone) configName = selectConfigName(opts, db9Token)
  else configName = path.basename(selectConfig(root!, opts, db9Token))

  const configText = getSelectedConfigText(projectDir, root, embedded, opts, db9Token)
  const sessionPlan = createRunSessionPlan({
    goal,
    opts,
    launchPlan,
    configName,
    configText,
    standalone,
    db9Token,
    env: hostEnv,
  })
  const {
    brainName,
    runId,
    useThirdPartyApi,
    useHybrid,
    runtimeOverride,
    codexConfigLabel,
    requiredRuntimes,
    runtimeLabel,
    llmModeLabel,
  } = sessionPlan
  const sourceLabel = spec.sourceLabel ?? sessionPlan.sourceLabel

  console.log(`
  ┌─────────────────────────────────────────────────┐
  │  wanman run                                     │
  ├─────────────────────────────────────────────────┤
  │  Goal:   ${goal.slice(0, 40).padEnd(40)}│
  │  Loops:  ${(opts.infinite ? '∞ (infinite)' : String(opts.loops)).padEnd(40)}│
  │  Config: ${configName.padEnd(40)}│
  │  Source: ${sourceLabel.padEnd(40)}│
  │  Brain:  ${(brainName ?? 'disabled').padEnd(40)}│
  │  Runtime:${runtimeLabel.padEnd(40)}│
  │  LLM:    ${llmModeLabel.padEnd(40)}│
${codexConfigLabel ? `  │  Codex:  ${codexConfigLabel.padEnd(40)}│\n` : ''}  └─────────────────────────────────────────────────┘
`)

  if (root) {
    console.log('  [1/6] Checking builds...')
    buildIfNeeded(root)
  } else {
    console.log('  [1/6] Skip build (no monorepo)')
  }

  if (opts.local) {
    console.log('  [2/4] Preparing local workspace...')
    const localLayout = materializeLocalRunLayout({
      runId,
      outputDir: opts.output,
      projectDir,
      root,
      embedded,
      configText,
      gitRoot: localGitRoot,
    })
    await runLocalExecution({
      goal,
      opts,
      spec,
      runId,
      localLayout,
      runtime: {
        runtime: runtimeOverride === 'codex' ? 'codex' : runtimeOverride === 'claude' ? 'claude' : undefined,
        codexModel: opts.codexModel,
        codexReasoningEffort: opts.codexReasoningEffort,
      },
      sandboxRepoRoot,
      brainName,
      hooks,
      observeExecution: observeExecutionBackend,
      downloadDeliverables: downloadLocalDeliverables,
      downloadRepoPatch: downloadLocalRepoPatch,
    })
    return
  }

  const sandboxEnv = createSandboxRuntimeEnv({
    opts,
    db9Token,
    brainName,
    runtimeOverride,
    workspaceRoot,
    sandboxGitRoot,
    storySync: spec.storySync,
    env: hostEnv,
  })
  await runSandboxExecution({
    goal,
    opts,
    spec,
    runId,
    workspaceRoot,
    sandboxRepoRoot,
    brainName,
    hooks,
    sandboxEnv,
    hostEnv,
    prepareSandbox: async (sandbox) => {
      if (spec.repoCloneUrl && spec.githubToken && sandboxRepoRoot) {
        const { setupGitInSandbox, cloneRepo } = await import('./commands/sandbox-git.js')
        const { runBootstrap } = await import('./commands/runtime-bootstrap.js')
        console.log('  [4/6] Cloning repo + installing deps...')
        await setupGitInSandbox(sandbox, spec.githubToken)
        await cloneRepo(sandbox, spec.repoCloneUrl, sandboxRepoRoot)
        if (spec.bootstrapScript) {
          await runBootstrap(sandbox, spec.bootstrapScript, sandboxRepoRoot)
        }
      }

      console.log(`  [${spec.repoCloneUrl ? '5' : '4'}/6] Uploading bundle...`)
      if (projectDir) {
        const runtimeSource = root ? { root } : { embedded: embedded! }
        await uploadProjectBundle(sandbox, projectDir, runtimeSource, workspaceRoot)
      } else if (standalone) {
        await uploadBundleStandalone(sandbox, embedded!, configName)
      } else {
        await uploadBundle(sandbox, root!, selectConfig(root!, opts, db9Token))
      }
      if (!spec.repoCloneUrl && repoSourceDir && sandboxRepoRoot) {
        await uploadRepoSnapshot(sandbox, repoSourceDir, sandboxRepoRoot)
      }

      console.log('  [5/6] Setting up auth...')
      await setupAuth(sandbox, {
        useThirdPartyApi: useThirdPartyApi || useHybrid,
        runtimes: requiredRuntimes,
      })
    },
    observeExecution: observeExecutionBackend,
    downloadDeliverables,
    downloadRepoPatch,
  })
}
