import { createProvider } from '@sandbank.dev/core'
import type { Sandbox, SandboxProvider } from '@sandbank.dev/core'
import { resolveSandbankCloudConfig } from '@wanman/host-sdk'
import { createSandboxExecutionBackend, type ExecutionBackend } from './execution-backend.js'
import type { ExecutionHooks, ProjectRunSpec, RunOptions } from './execution-session.js'
import type { RuntimeClient } from './runtime-client.js'
import { createSandboxRuntimeClient } from './runtime-client.js'
import { SandbankCloudAdapter } from './sandbank-cloud.js'

export interface SandboxRunObservationParams {
  backend: ExecutionBackend
  goal: string
  opts: RunOptions
  spec: ProjectRunSpec
  runId: string
  workspaceRoot: string
  sandboxRepoRoot?: string
  brainName?: string
  hooks?: ExecutionHooks
  shouldStop: () => boolean
}

export interface SandboxRunExecutorParams {
  goal: string
  opts: RunOptions
  spec: ProjectRunSpec
  runId: string
  workspaceRoot: string
  sandboxRepoRoot?: string
  brainName?: string
  hooks?: ExecutionHooks
  sandboxEnv: Record<string, string>
  hostEnv?: NodeJS.ProcessEnv
  prepareSandbox(sandbox: Sandbox): Promise<void>
  observeExecution(params: SandboxRunObservationParams): Promise<unknown>
  downloadDeliverables(
    sandbox: Sandbox,
    runtime: RuntimeClient,
    outputDir: string,
    brainName?: string,
    workspaceRoot?: string,
  ): Promise<void>
  downloadRepoPatch(
    sandbox: Sandbox,
    outputDir: string,
    repoRoot: string,
    brainName?: string,
  ): Promise<void>
}

export async function runSandboxExecution(params: SandboxRunExecutorParams): Promise<void> {
  const {
    goal,
    opts,
    spec,
    runId,
    workspaceRoot,
    sandboxRepoRoot,
    brainName,
    hooks,
    sandboxEnv,
  } = params
  const hostEnv = params.hostEnv ?? process.env

  console.log('  [2/6] Creating sandbox...')
  const { provider, providerType, cloudAdapter } = await resolveSandboxProvider(hostEnv)
  console.log(`  Provider: ${providerType}`)

  const image = 'codebox'
  const cloneFrom = opts.cloneFrom || hostEnv['SANDBANK_CLONE_FROM']
  let sandbox: Sandbox

  if (cloneFrom && cloudAdapter) {
    console.log(`  Cloning box ${cloneFrom}...`)
    const cloned = await cloudAdapter.cloneSandbox(cloneFrom)
    sandbox = await provider.get(cloned.id)
    await sandbox.writeFile('/opt/wanman/env', serializeShellExports(sandboxEnv))
  } else {
    sandbox = await provider.create({ image, env: sandboxEnv, resources: { disk: 5 }, timeout: 120 })
  }
  console.log(`  Sandbox: ${sandbox.id} (${cloneFrom ? 'cloned' : image})`)

  const runtime = createSandboxRuntimeClient(sandbox)
  const backend = createSandboxExecutionBackend(sandbox, runtime)

  let shuttingDown = false
  const cleanup = async () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('\n  Shutting down...')
    if (!opts.keep) {
      try { await provider.destroy(sandbox.id) } catch { /* ignore */ }
      console.log('  Sandbox destroyed.')
    } else {
      console.log(`  Sandbox kept alive: ${sandbox.id}`)
    }
    process.exit(0)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  try {
    console.log('  [3/6] Codebox image — skip provisioning')
    await params.prepareSandbox(sandbox)
    await prepareSandboxUserHome(sandbox, workspaceRoot)

    console.log('  [6/6] Starting supervisor...')
    // Pass goal as base64 so shell tokenisation can't interact with it —
    // the runtime entrypoint decodes WANMAN_GOAL_B64 back to WANMAN_GOAL.
    const goalB64 = Buffer.from(goal, 'utf-8').toString('base64')
    await sandbox.exec(
      `source /opt/wanman/env 2>/dev/null; WANMAN_AGENT_USER=wanman WANMAN_GOAL_B64='${goalB64}' nohup node /opt/wanman/runtime/entrypoint.js > /tmp/supervisor.log 2>&1 &`,
    )
    await new Promise(resolve => setTimeout(resolve, 5000))
    await runtime.waitForHealth()
    console.log('  Supervisor healthy!\n')

    await params.observeExecution({
      backend,
      goal,
      opts,
      spec,
      runId,
      workspaceRoot,
      sandboxRepoRoot,
      brainName,
      hooks,
      shouldStop: () => shuttingDown,
    })

    await params.downloadDeliverables(sandbox, runtime, opts.output, brainName, workspaceRoot)
    if (sandboxRepoRoot) {
      await params.downloadRepoPatch(sandbox, opts.output, sandboxRepoRoot, brainName)
    }

    if (brainName) {
      console.log(`  Brain database: ${brainName}`)
      console.log('  Query: db9 db sql <id> -q "SELECT agent, kind, count(*) FROM artifacts GROUP BY agent, kind"')
    }
  } catch (err) {
    console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
    try { await params.downloadDeliverables(sandbox, runtime, opts.output, brainName, workspaceRoot) } catch { /* best-effort */ }
    if (sandboxRepoRoot) {
      try { await params.downloadRepoPatch(sandbox, opts.output, sandboxRepoRoot, brainName) } catch { /* best-effort */ }
    }
  } finally {
    process.off('SIGINT', cleanup)
    process.off('SIGTERM', cleanup)
    if (!opts.keep && !shuttingDown) {
      try { await provider.destroy(sandbox.id) } catch { /* ignore */ }
      console.log('  Sandbox destroyed.')
    }
  }
}

function serializeShellExports(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `export ${key}='${value.replace(/'/g, "'\\''")}'`)
    .join('\n')
}

async function prepareSandboxUserHome(sandbox: Sandbox, workspaceRoot: string): Promise<void> {
  await sandbox.exec('useradd -m -s /bin/bash wanman 2>/dev/null || true')
  const home = (await sandbox.exec('echo $HOME')).stdout.trim() || '/root'

  // WANMAN_SANDBOX_CREDENTIALS=minimal (default) copies only the files the agent
  // runtimes actually need (OAuth credentials + minimal config). `full` preserves
  // the historical whole-directory copy for local debugging.
  const credMode = (process.env['WANMAN_SANDBOX_CREDENTIALS'] ?? 'minimal').toLowerCase()
  await sandbox.exec(`mkdir -p /home/wanman/.claude /home/wanman/.codex`)

  if (credMode === 'full') {
    await sandbox.exec(`cp -a ${home}/.claude/. /home/wanman/.claude/ 2>/dev/null || true`)
    await sandbox.exec(`cp ${home}/.claude.json /home/wanman/.claude.json 2>/dev/null || true`)
    await sandbox.exec(`cp -a ${home}/.codex/. /home/wanman/.codex/ 2>/dev/null || true`)
  } else {
    // Minimal mode: copy only the auth token files needed to make API calls.
    // MCP history, prompt cache, and session logs stay on the host.
    const claudeWhitelist = ['.credentials.json', 'settings.local.json']
    for (const f of claudeWhitelist) {
      await sandbox.exec(`cp ${home}/.claude/${f} /home/wanman/.claude/${f} 2>/dev/null || true`)
    }
    await sandbox.exec(`cp ${home}/.claude.json /home/wanman/.claude.json 2>/dev/null || true`)
    const codexWhitelist = ['auth.json', 'config.toml']
    for (const f of codexWhitelist) {
      await sandbox.exec(`cp ${home}/.codex/${f} /home/wanman/.codex/${f} 2>/dev/null || true`)
    }
    // TODO(security): replace file copy with an OAuth proxy so the sandbox never
    // sees long-lived tokens in the first place.
  }

  await sandbox.exec('chown -R wanman:wanman /home/wanman/.claude /home/wanman/.claude.json /home/wanman/.codex 2>/dev/null || true')
  // ug+rw (not a+rw) — workspaceRoot belongs to wanman; `other` gets no write bit.
  await sandbox.exec(`chown -R wanman:wanman '${workspaceRoot}' 2>/dev/null || true`)
  await sandbox.exec(`chmod -R ug+rw '${workspaceRoot}' 2>/dev/null || true`)
}

async function resolveSandboxProvider(env: NodeJS.ProcessEnv): Promise<{
  provider: SandboxProvider
  providerType: string
  cloudAdapter?: SandbankCloudAdapter
}> {
  const sandbank = resolveSandbankCloudConfig(env)

  if (sandbank) {
    const cloudAdapter = new SandbankCloudAdapter({
      apiUrl: sandbank.apiUrl,
      apiKey: sandbank.apiKey ?? '',
      image: sandbank.image,
    })
    return {
      provider: createProvider(cloudAdapter),
      providerType: `sandbank-cloud (${sandbank.apiUrl})`,
      cloudAdapter,
    }
  }

  if (env['DAYTONA_API_KEY']) {
    const { DaytonaAdapter } = await import('@sandbank.dev/daytona')
    const adapter = new DaytonaAdapter({
      apiKey: env['DAYTONA_API_KEY'],
      apiUrl: env['DAYTONA_API_URL'],
    })
    return {
      provider: createProvider(adapter),
      providerType: 'daytona',
    }
  }

  throw new Error(
    'No sandbox provider configured.\n'
    + 'Set SANDBANK_URL (e.g. http://localhost:3140) or DAYTONA_API_KEY.',
  )
}
