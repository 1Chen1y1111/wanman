import * as os from 'node:os'
import * as path from 'node:path'
import type {
  AppendLaunchEventRequestRecord,
  LaunchClaimRecord,
  LaunchRunnerApiClient,
  LaunchRecord,
  RunLaunchInputRecord,
  TakeoverLaunchInputRecord,
} from '@wanman/core'
import type { WanmanHostRunOptions, WanmanHostSdk } from './host-sdk.js'
import { createEnvBackedWanmanHostSdk } from './host-sdk.js'
import { createCliLaunchRunnerClient, type CliLaunchRunnerOptions } from './launch-runner-client.js'
import { materializeTakeoverProject, type MaterializedProject } from './project-materialization.js'

export interface LaunchRunnerDependencies {
  client: LaunchRunnerApiClient
  sdk: WanmanHostSdk
  sleep(ms: number): Promise<void>
  prepareTakeoverProject(launch: LaunchRecord, input: TakeoverLaunchInputRecord): Promise<MaterializedProject>
  storySyncUrl?: string | null
  storySyncSecret?: string | null
  logger: Pick<Console, 'log' | 'error'>
}

export interface LaunchRunnerOptions {
  runnerId?: string
  pollIntervalMs?: number
  heartbeatIntervalMs?: number
  outputRoot?: string
  once?: boolean
}

export interface CreateCliLaunchRunnerOptions extends CliLaunchRunnerOptions, LaunchRunnerOptions {
  env?: NodeJS.ProcessEnv
}

export interface LaunchRunnerResult {
  claimed: boolean
  status?: 'completed' | 'failed'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defaultOutputPath(outputRoot: string, launchId: string): string {
  return path.join(outputRoot, launchId)
}

function buildRunOptions(
  launch: LaunchRecord,
  input: RunLaunchInputRecord | TakeoverLaunchInputRecord,
  outputRoot: string,
): WanmanHostRunOptions {
  return {
    mode: 'sandbox',
    runtime: input.runtime,
    loops: input.loops ?? undefined,
    infinite: input.infinite ?? undefined,
    pollInterval: input.poll_interval ?? undefined,
    keep: input.keep ?? undefined,
    output: input.output ?? defaultOutputPath(outputRoot, launch.id),
    codexModel: input.codex_model ?? undefined,
    codexReasoningEffort: input.codex_reasoning_effort ?? undefined,
  }
}

function isTakeoverLaunch(launch: LaunchRecord): launch is LaunchRecord & { kind: 'takeover'; payload: TakeoverLaunchInputRecord } {
  return launch.kind === 'takeover'
}

async function appendLaunchEvent(
  deps: LaunchRunnerDependencies,
  launchId: string,
  input: AppendLaunchEventRequestRecord,
): Promise<void> {
  try {
    await deps.client.appendLaunchEvent(launchId, input)
  } catch (error) {
    deps.logger.error(`Launch event append failed for ${launchId}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function executeClaimedLaunch(
  claim: LaunchClaimRecord,
  deps: LaunchRunnerDependencies,
  options: Required<Pick<LaunchRunnerOptions, 'heartbeatIntervalMs' | 'outputRoot'>>,
): Promise<'completed' | 'failed'> {
  const { launch, claim_token: claimToken } = claim
  const heartbeat = setInterval(() => {
    void deps.client.heartbeatLaunch(launch.id, { claim_token: claimToken }).catch((error) => {
      deps.logger.error(`Launch heartbeat failed for ${launch.id}: ${error instanceof Error ? error.message : String(error)}`)
    })
  }, options.heartbeatIntervalMs)

  try {
    if (isTakeoverLaunch(launch)) {
      const takeoverInput = launch.payload
      await appendLaunchEvent(deps, launch.id, {
        claim_token: claimToken,
        event_type: 'project.materialization.started',
        message: 'Materializing takeover repository',
        payload: {
          repo_url: takeoverInput.repo_url,
          repo_ref: takeoverInput.repo_ref ?? null,
          repo_auth: takeoverInput.repo_auth ?? 'public',
          github_installation_id: takeoverInput.github_installation_id ?? null,
        },
      })
      const prepared = await deps.prepareTakeoverProject(launch, takeoverInput)
      try {
        const storySync = launch.story_id && deps.storySyncUrl
          ? {
              storyId: launch.story_id,
              syncUrl: deps.storySyncUrl,
              syncSecret: deps.storySyncSecret ?? undefined,
            }
          : undefined
        await appendLaunchEvent(deps, launch.id, {
          claim_token: claimToken,
          event_type: 'project.materialization.completed',
          message: 'Takeover repository materialized',
          payload: {
            repo_url: takeoverInput.repo_url,
            repo_ref: takeoverInput.repo_ref ?? null,
            repo_auth: takeoverInput.repo_auth ?? 'public',
            github_installation_id: takeoverInput.github_installation_id ?? null,
          },
        })
        await appendLaunchEvent(deps, launch.id, {
          claim_token: claimToken,
          event_type: 'execution.started',
          message: 'Takeover execution started',
          payload: {
            kind: launch.kind,
            runtime: takeoverInput.runtime ?? null,
          },
        })
        await deps.sdk.takeover({
          projectPath: prepared.projectPath,
          goalOverride: takeoverInput.goal_override ?? undefined,
          runtime: takeoverInput.runtime,
          mode: 'sandbox',
          enableBrain: takeoverInput.enable_brain ?? true,
          storySync,
        }, {
          ...buildRunOptions(launch, takeoverInput, options.outputRoot),
          noBrain: takeoverInput.enable_brain === false,
        })
      } finally {
        await prepared.cleanup()
      }
    } else {
      const runInput = launch.payload as RunLaunchInputRecord
      await appendLaunchEvent(deps, launch.id, {
        claim_token: claimToken,
        event_type: 'execution.started',
        message: 'Run execution started',
        payload: {
          kind: launch.kind,
          runtime: runInput.runtime ?? null,
          goal: runInput.goal,
        },
      })
      await deps.sdk.run(runInput.goal, {
        ...buildRunOptions(launch, runInput, options.outputRoot),
        noBrain: runInput.no_brain ?? undefined,
      })
    }

    await appendLaunchEvent(deps, launch.id, {
      claim_token: claimToken,
      event_type: 'execution.completed',
      message: 'Launch execution finished successfully',
    })
    await deps.client.completeLaunch(launch.id, { claim_token: claimToken })
    deps.logger.log(`Launch ${launch.id} completed`)
    return 'completed'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendLaunchEvent(deps, launch.id, {
      claim_token: claimToken,
      event_type: 'execution.failed',
      message,
      payload: { error: message },
    })
    await deps.client.failLaunch(launch.id, { claim_token: claimToken, error: message })
    deps.logger.error(`Launch ${launch.id} failed: ${message}`)
    return 'failed'
  } finally {
    clearInterval(heartbeat)
  }
}

export async function runLaunchRunnerOnce(
  deps: LaunchRunnerDependencies,
  options: LaunchRunnerOptions = {},
): Promise<LaunchRunnerResult> {
  const runnerId = options.runnerId ?? `runner-${process.pid}`
  const claim = await deps.client.claimNextLaunch({ runner_id: runnerId })
  if (!claim) return { claimed: false }

  deps.logger.log(`Claimed launch ${claim.launch.id} (${claim.launch.kind})`)
  const status = await executeClaimedLaunch(claim, deps, {
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 15_000,
    outputRoot: options.outputRoot ?? path.join(os.tmpdir(), 'wanman-launches'),
  })

  return { claimed: true, status }
}

export async function runLaunchRunner(
  deps: LaunchRunnerDependencies,
  options: LaunchRunnerOptions = {},
): Promise<void> {
  const once = options.once ?? false
  const pollIntervalMs = options.pollIntervalMs ?? 5_000

  do {
    const result = await runLaunchRunnerOnce(deps, options)
    if (once) return
    if (!result.claimed) await deps.sleep(pollIntervalMs)
  } while (true)
}

export function createCliLaunchRunner(
  options: CreateCliLaunchRunnerOptions,
): { run(): Promise<void>; runOnce(): Promise<LaunchRunnerResult> } {
  const apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, '')
  const env = options.env ?? process.env
  const deps: LaunchRunnerDependencies = {
    client: createCliLaunchRunnerClient({
      apiBaseUrl,
      runnerSecret: options.runnerSecret,
    }),
    sdk: createEnvBackedWanmanHostSdk(env),
    sleep: delay,
    prepareTakeoverProject: materializeTakeoverProject,
    storySyncUrl: `${apiBaseUrl}/api/sync`,
    storySyncSecret: env['WANMAN_SYNC_SECRET'] ?? env['SYNC_SECRET'] ?? null,
    logger: console,
  }

  return {
    run: () => runLaunchRunner(deps, options),
    runOnce: () => runLaunchRunnerOnce(deps, options),
  }
}
