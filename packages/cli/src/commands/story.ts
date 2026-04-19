import {
  getStoryRunStatus,
  type StoryDetailRecord,
} from '@wanman/core'
import {
  createCliStorySdk,
  type CliStoryApiOptions,
} from '../story-api-client.js'

const STORY_HELP = `wanman story — Story run API CLI

Usage:
  wanman story list
  wanman story get <id>
  wanman story current-run <id>
  wanman story watch <id>
  wanman story start <id>
  wanman story pause <id>
  wanman story resume <id>
  wanman story stop <id>
  wanman story delete <id>

Options:
  --api-url <url>   Story API base URL (default: WANMAN_API_URL)
  --token <token>   Bearer token for the story API (default: WANMAN_API_TOKEN)
`

interface StoryCommandOptions {
  apiUrl?: string
  token?: string
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

function parseOptions(args: string[]): StoryCommandOptions {
  return {
    apiUrl: consumeFlag(args, '--api-url'),
    token: consumeFlag(args, '--token'),
  }
}

function requireStoryId(subcommand: string | undefined, args: string[]): string {
  const storyId = args[1]
  if (storyId) return storyId

  console.error(`Story id is required for "${subcommand}"`)
  console.log(STORY_HELP)
  process.exit(1)
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

async function watchStory(storyId: string, options: CliStoryApiOptions): Promise<void> {
  const sdk = createCliStorySdk(options)

  for await (const event of sdk.observeSession<StoryDetailRecord>(storyId)) {
    if (event.kind === 'snapshot') {
      printJson({
        eventType: 'snapshot',
        story: event.state.story,
        artifacts: event.state.artifacts,
        tasks: event.state.tasks,
      })
      continue
    }

    printJson({
      eventType: event.message?.eventType ?? 'message',
      data: event.message?.data ?? null,
      storyStatus: getStoryRunStatus(event.state.story),
    })
  }
}

export async function storyCommand(rawArgs: string[]): Promise<void> {
  const args = [...rawArgs]
  const options = parseOptions(args)
  const subcommand = args[0]

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    console.log(STORY_HELP)
    return
  }

  const apiUrl = options.apiUrl ?? process.env['WANMAN_API_URL']
  const token = options.token ?? process.env['WANMAN_API_TOKEN']

  if (!apiUrl || !token) {
    console.error('WANMAN_API_URL and WANMAN_API_TOKEN are required for story API commands.')
    console.log(STORY_HELP)
    process.exit(1)
  }

  const clientOptions = { apiBaseUrl: apiUrl, token }
  const sdk = createCliStorySdk(clientOptions)

  switch (subcommand) {
    case 'list':
      printJson(await sdk.listStories())
      return
    case 'get':
      printJson(await sdk.getStory(requireStoryId(subcommand, args)))
      return
    case 'current-run':
      printJson(await sdk.getCurrentRun(requireStoryId(subcommand, args)))
      return
    case 'watch':
      await watchStory(requireStoryId(subcommand, args), clientOptions)
      return
    case 'start':
      printJson((await sdk.startStory(requireStoryId(subcommand, args))).response)
      return
    case 'pause':
      printJson((await sdk.pauseStory(requireStoryId(subcommand, args))).response)
      return
    case 'resume':
      printJson((await sdk.resumeStory(requireStoryId(subcommand, args))).response)
      return
    case 'stop':
      printJson((await sdk.stopStory(requireStoryId(subcommand, args))).response)
      return
    case 'delete':
      printJson(await sdk.deleteStory(requireStoryId(subcommand, args)))
      return
    default:
      console.error(`Unknown story subcommand: ${subcommand}`)
      console.log(STORY_HELP)
      process.exit(1)
  }
}
