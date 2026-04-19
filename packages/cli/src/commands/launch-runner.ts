import { createCliLaunchRunner } from '../launch-runner.js'

const LAUNCH_RUNNER_HELP = `wanman launch-runner — Host launch queue runner

Usage:
  wanman launch-runner [options]

Options:
  --api-url <url>        Control plane API base URL (default: WANMAN_API_URL)
  --secret <token>       Internal launch runner secret (default: WANMAN_RUNNER_SECRET)
  --runner-id <id>       Stable runner identifier
  --poll-ms <ms>         Idle poll interval in milliseconds (default: 5000)
  --heartbeat-ms <ms>    Running heartbeat interval in milliseconds (default: 15000)
  --output-root <path>   Base directory for launch outputs (default: /tmp/wanman-launches)
  --once                 Claim and process at most one queued launch
`

interface LaunchRunnerCommandOptions {
  apiUrl?: string
  secret?: string
  runnerId?: string
  pollIntervalMs?: number
  heartbeatIntervalMs?: number
  outputRoot?: string
  once: boolean
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

function consumeBooleanFlag(args: string[], flag: string): boolean {
  const index = args.indexOf(flag)
  if (index === -1) return false
  args.splice(index, 1)
  return true
}

function parseLaunchRunnerOptions(rawArgs: string[]): LaunchRunnerCommandOptions {
  const args = [...rawArgs]
  const pollMs = consumeFlag(args, '--poll-ms')
  const heartbeatMs = consumeFlag(args, '--heartbeat-ms')
  return {
    apiUrl: consumeFlag(args, '--api-url'),
    secret: consumeFlag(args, '--secret'),
    runnerId: consumeFlag(args, '--runner-id'),
    pollIntervalMs: pollMs ? Number(pollMs) : undefined,
    heartbeatIntervalMs: heartbeatMs ? Number(heartbeatMs) : undefined,
    outputRoot: consumeFlag(args, '--output-root'),
    once: consumeBooleanFlag(args, '--once'),
  }
}

export async function launchRunnerCommand(rawArgs: string[]): Promise<void> {
  if (rawArgs[0] === '--help' || rawArgs[0] === '-h') {
    console.log(LAUNCH_RUNNER_HELP)
    return
  }

  const options = parseLaunchRunnerOptions(rawArgs)
  const apiUrl = options.apiUrl ?? process.env['WANMAN_API_URL']
  const runnerSecret = options.secret ?? process.env['WANMAN_RUNNER_SECRET']

  if (!apiUrl || !runnerSecret) {
    console.error('WANMAN_API_URL and WANMAN_RUNNER_SECRET are required for launch-runner.')
    console.log(LAUNCH_RUNNER_HELP)
    process.exit(1)
  }

  const runner = createCliLaunchRunner({
    apiBaseUrl: apiUrl,
    runnerSecret,
    runnerId: options.runnerId,
    pollIntervalMs: options.pollIntervalMs,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    outputRoot: options.outputRoot,
    once: options.once,
  })

  if (options.once) {
    await runner.runOnce()
    return
  }

  await runner.run()
}
