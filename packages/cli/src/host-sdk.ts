import {
  createEnvBackedWanmanHostSdk as createBaseEnvBackedWanmanHostSdk,
  createWanmanHostSdk as createBaseWanmanHostSdk,
  type WanmanExecutionMode,
  type WanmanHostSdkAdapters,
  type WanmanHostRunInvocation as BaseWanmanHostRunInvocation,
  type WanmanHostSdk as BaseWanmanHostSdk,
  type WanmanHostRunOptions,
  type WanmanHostSdkConfig,
  type WanmanHostTakeoverOptions,
} from '@wanman/host-sdk'
import type { ProjectRunSpec } from './execution-session.js'
import { runGoal } from './run-host.js'
import {
  executePreparedTakeoverLaunch,
  prepareTakeoverLaunch,
  type PreparedTakeoverLaunch,
  type PrepareTakeoverLaunchOptions,
} from './takeover-launch.js'

export type {
  WanmanExecutionMode,
  WanmanHostRunOptions,
  WanmanHostSdkConfig,
  WanmanHostTakeoverOptions,
} from '@wanman/host-sdk'

export type WanmanHostRunInvocation = BaseWanmanHostRunInvocation
export type WanmanHostTakeoverInvocation = PrepareTakeoverLaunchOptions | WanmanHostTakeoverOptions

export type WanmanHostSdk = BaseWanmanHostSdk<
  ProjectRunSpec,
  PreparedTakeoverLaunch,
  WanmanHostTakeoverInvocation
>

function resolveMode(mode: WanmanExecutionMode | undefined, defaultMode: WanmanExecutionMode): WanmanExecutionMode {
  return mode ?? defaultMode
}

function isPreparedTakeoverLaunchOptions(
  options: WanmanHostTakeoverInvocation,
): options is PrepareTakeoverLaunchOptions {
  return 'local' in options
}

function normalizeTakeoverOptions(
  options: WanmanHostTakeoverInvocation,
  defaultMode: WanmanExecutionMode,
): PrepareTakeoverLaunchOptions {
  if (isPreparedTakeoverLaunchOptions(options)) return options

  return {
    projectPath: options.projectPath,
    goalOverride: options.goalOverride,
    runtime: options.runtime ?? 'claude',
    githubToken: options.githubToken,
    local: resolveMode(options.mode, defaultMode) === 'local',
    enableBrain: options.enableBrain ?? true,
  }
}

const adapters: WanmanHostSdkAdapters<ProjectRunSpec, PreparedTakeoverLaunch, PrepareTakeoverLaunchOptions> = {
  runGoal,
  prepareTakeoverLaunch,
  executePreparedTakeoverLaunch,
  normalizeTakeoverOptions,
}

export function createWanmanHostSdk(config: WanmanHostSdkConfig = {}): WanmanHostSdk {
  return createBaseWanmanHostSdk(config, adapters)
}

export function createEnvBackedWanmanHostSdk(
  env: NodeJS.ProcessEnv = process.env,
  config: Omit<WanmanHostSdkConfig, 'env' | 'sandbank'> = {},
): WanmanHostSdk {
  return createBaseEnvBackedWanmanHostSdk(env, config, adapters)
}
