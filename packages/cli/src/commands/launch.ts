import {
  getLaunchUpdatedAt,
  type LaunchDetailRecord,
} from '@wanman/core'
import {
  createCliLaunchSdk,
  type CliLaunchApiOptions,
} from '../launch-api-client.js'

const LAUNCH_HELP = `wanman launch — Launch control-plane CLI

Usage:
  wanman launch list
  wanman launch get <id>
  wanman launch watch <id>
  wanman launch cancel <id>
  wanman launch run <goal>
  wanman launch takeover <repo-url> [--ref <ref>] [--goal <goal>] [--repo-auth <mode>] [--installation-id <id>]
  wanman launch retry <id>

Options:
  --api-url <url>   Control plane API base URL (default: WANMAN_API_URL)
  --token <token>   Bearer token for the control plane API (default: WANMAN_API_TOKEN)
  --ref <ref>       Takeover repository ref / branch
  --goal <goal>     Takeover goal override
  --repo-auth <m>   Takeover repo access: public | runner-env | github-app
  --installation-id Installation id required when --repo-auth github-app
`

interface LaunchCommandOptions {
  apiUrl?: string
  token?: string
  ref?: string
  goal?: string
  repoAuth?: 'public' | 'runner_env' | 'github_app'
  installationId?: number
}

function consumeFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined

  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    console.error(`Missing value for ${flag}`)
    process.exit(1)
  }

  args.splice(index, 2)
  return value
}

function parseOptions(args: string[]): LaunchCommandOptions {
  const repoAuth = consumeFlag(args, '--repo-auth')
  const installationIdRaw = consumeFlag(args, '--installation-id')
  const normalizedRepoAuth = repoAuth?.trim().toLowerCase().replace('-', '_')
  if (normalizedRepoAuth && normalizedRepoAuth !== 'public' && normalizedRepoAuth !== 'runner_env' && normalizedRepoAuth !== 'github_app') {
    console.error(`Invalid --repo-auth value: ${repoAuth}. Use public, runner-env, or github-app.`)
    process.exit(1)
  }
  const installationId = installationIdRaw ? Number.parseInt(installationIdRaw, 10) : undefined
  if (installationIdRaw && !Number.isFinite(installationId)) {
    console.error(`Invalid --installation-id value: ${installationIdRaw}`)
    process.exit(1)
  }

  return {
    apiUrl: consumeFlag(args, '--api-url'),
    token: consumeFlag(args, '--token'),
    ref: consumeFlag(args, '--ref'),
    goal: consumeFlag(args, '--goal'),
    repoAuth: normalizedRepoAuth as LaunchCommandOptions['repoAuth'],
    installationId,
  }
}

function requireLaunchId(subcommand: string | undefined, args: string[]): string {
  const launchId = args[1]
  if (launchId) return launchId

  console.error(`Launch id is required for "${subcommand}"`)
  console.log(LAUNCH_HELP)
  process.exit(1)
}

function requireRunGoal(args: string[]): string {
  const goal = args.slice(1).join(' ').trim()
  if (goal) return goal

  console.error('Run goal is required for "wanman launch run"')
  console.log(LAUNCH_HELP)
  process.exit(1)
}

function requireRepoUrl(args: string[]): string {
  const repoUrl = args[1]?.trim()
  if (repoUrl) return repoUrl

  console.error('Repository URL is required for "wanman launch takeover"')
  console.log(LAUNCH_HELP)
  process.exit(1)
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

async function watchLaunch(launchId: string, options: CliLaunchApiOptions): Promise<void> {
  const sdk = createCliLaunchSdk(options)

  for await (const event of sdk.observeLaunch<LaunchDetailRecord>(launchId)) {
    if (event.kind === 'snapshot') {
      printJson({
        eventType: 'snapshot',
        launch: event.launch,
      })
      continue
    }

    printJson({
      eventType: event.message?.eventType ?? 'message',
      launchId: event.launch.id,
      launchStatus: event.launch.status,
      timelineLength: event.launch.timeline.length,
      updatedAt: getLaunchUpdatedAt(event.launch),
    })
  }
}

export async function launchCommand(rawArgs: string[]): Promise<void> {
  const args = [...rawArgs]
  const options = parseOptions(args)
  const subcommand = args[0]

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    console.log(LAUNCH_HELP)
    return
  }

  const apiUrl = options.apiUrl ?? process.env['WANMAN_API_URL']
  const token = options.token ?? process.env['WANMAN_API_TOKEN']

  if (!apiUrl || !token) {
    console.error('WANMAN_API_URL and WANMAN_API_TOKEN are required for launch API commands.')
    console.log(LAUNCH_HELP)
    process.exit(1)
  }

  const clientOptions = { apiBaseUrl: apiUrl, token }
  const sdk = createCliLaunchSdk(clientOptions)

  switch (subcommand) {
    case 'list':
      printJson(await sdk.listLaunches())
      return
    case 'get':
      printJson(await sdk.getLaunch(requireLaunchId(subcommand, args)))
      return
    case 'watch':
      await watchLaunch(requireLaunchId(subcommand, args), clientOptions)
      return
    case 'cancel':
      printJson(await sdk.cancelLaunch(requireLaunchId(subcommand, args)))
      return
    case 'run':
      printJson(await sdk.createRunLaunch({ goal: requireRunGoal(args) }))
      return
    case 'takeover':
      printJson(await sdk.createTakeoverLaunch({
        repo_url: requireRepoUrl(args),
        repo_ref: options.ref ?? null,
        goal_override: options.goal ?? null,
        repo_auth: options.repoAuth,
        github_installation_id: options.installationId ?? null,
      }))
      return
    case 'retry':
      printJson(await sdk.retryLaunch(requireLaunchId(subcommand, args)))
      return
    default:
      console.error(`Unknown launch subcommand: ${subcommand}`)
      console.log(LAUNCH_HELP)
      process.exit(1)
  }
}
