/**
 * wanman CLI entrypoint.
 *
 * Usage:
 *   wanman send <agent> <message> [--steer] [--type <message|decision|blocker>]
 *   wanman recv [--agent <name>]
 *   wanman agents
 *   wanman context get|set <key> [value]
 *   wanman escalate <message>
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendCommand } from './commands/send.js';
import { recvCommand } from './commands/recv.js';
import { agentsCommand } from './commands/agents.js';
import { contextCommand } from './commands/context.js';
import { escalateCommand } from './commands/escalate.js';
import { taskCommand } from './commands/task.js';
import { initiativeCommand } from './commands/initiative.js';
import { capsuleCommand } from './commands/capsule.js';
import { artifactCommand } from './commands/artifact.js';
import { hypothesisCommand } from './commands/hypothesis.js';
import { storyCommand } from './commands/story.js';
import { launchCommand } from './commands/launch.js';

export const HELP = `wanman — Agent Matrix CLI

Usage:
  wanman send <agent> <message> [--steer] [--type <message|decision|blocker>]   Send a message to an agent
  wanman recv [--agent <name>]              Receive pending messages
  wanman agents                             List all agents and states
  wanman context get <key>                  Get shared context value
  wanman context set <key> <value>          Set shared context value
  wanman escalate <message>                 Escalate to CEO agent
  wanman task create <title> [flags]        Create a task
  wanman task list [--status s] [--assignee a]  List tasks
  wanman task get <id>                      Get task details
  wanman task update <id> --status <s> [--assignee a]  Update a task
  wanman task done <id> [result]            Mark task as done
  wanman initiative create <title> [flags]  Create an initiative
  wanman initiative list [--status s]       List initiatives
  wanman initiative get <id>                Get initiative details
  wanman initiative update <id> [flags]     Update an initiative
  wanman capsule create [flags]             Create a change capsule
  wanman capsule list [flags]               List change capsules
  wanman capsule mine [flags]               List capsules owned by the current agent
  wanman capsule get <id>                   Get capsule details
  wanman capsule update <id> [flags]        Update a capsule
  wanman artifact put [flags] '<json>'     Store structured artifact
  wanman artifact list [--agent a]         List artifacts
  wanman artifact get <id>                 Get artifact with content
  wanman hypothesis create <title> [flags] Create a hypothesis
  wanman hypothesis list [--status s]      List hypotheses
  wanman hypothesis update <id> --status s Update hypothesis
  wanman story <subcommand> [args]         Operate on web story runs via the API
  wanman launch <subcommand> [args]        Operate on control-plane launches via the API
  wanman launch-runner [options]          Consume queued control-plane launches
  wanman run <goal> [options]              Start agent matrix with a goal (host only)

Environment:
  WANMAN_URL          Supervisor URL (default: http://localhost:3120)
  WANMAN_API_URL      Web/API base URL for "wanman story" and "wanman launch" commands
  WANMAN_API_TOKEN    Bearer token for "wanman story" and "wanman launch" commands
  WANMAN_RUNNER_SECRET Internal secret for "wanman launch-runner"
  WANMAN_AGENT_NAME   Current agent name (used as default sender/receiver)
`;

/** Route a CLI command to the appropriate handler. Exported for testing. */
export async function run(command: string | undefined, args: string[]): Promise<void> {
  try {
    switch (command) {
      case 'send':
        await sendCommand(args);
        break;
      case 'recv':
        await recvCommand(args);
        break;
      case 'agents':
        await agentsCommand(args);
        break;
      case 'context':
        await contextCommand(args);
        break;
      case 'escalate':
        await escalateCommand(args);
        break;
      case 'task':
        await taskCommand(args);
        break;
      case 'initiative':
        await initiativeCommand(args);
        break;
      case 'capsule':
        await capsuleCommand(args);
        break;
      case 'artifact':
        await artifactCommand(args);
        break;
      case 'hypothesis':
        await hypothesisCommand(args);
        break;
      case 'story':
        await storyCommand(args);
        break;
      case 'launch':
        await launchCommand(args);
        break;
      case 'launch-runner': {
        try {
          const { launchRunnerCommand } = await import('./commands/launch-runner.js')
          await launchRunnerCommand(args)
        } catch (e) {
          if (e instanceof Error && (e.message.includes('Cannot find module') || e.message.includes('ERR_MODULE_NOT_FOUND'))) {
            console.error('"wanman launch-runner" is only available on the host machine, not inside a sandbox.')
            process.exit(1)
          }
          throw e
        }
        break
      }
      case 'run': {
        try {
          const { runCommand } = await import('./commands/run.js')
          await runCommand(args)
        } catch (e) {
          if (e instanceof Error && (e.message.includes('Cannot find module') || e.message.includes('ERR_MODULE_NOT_FOUND'))) {
            console.error('"wanman run" is only available on the host machine, not inside a sandbox.')
            process.exit(1)
          }
          throw e
        }
        break
      }
      case 'watch': {
        const { watchCommand } = await import('./commands/watch.js')
        await watchCommand(args)
        break
      }
      case 'skill:check': {
        const { skillCheckCommand } = await import('./commands/skill-check.js')
        await skillCheckCommand(args)
        break
      }
      case 'takeover': {
        try {
          const { takeoverCommand } = await import('./commands/takeover.js')
          await takeoverCommand(args)
        } catch (e) {
          if (e instanceof Error && (e.message.includes('Cannot find module') || e.message.includes('ERR_MODULE_NOT_FOUND'))) {
            console.error('"wanman takeover" is only available on the host machine, not inside a sandbox.')
            process.exit(1)
          }
          throw e
        }
        break
      }
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        console.log(HELP);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('fetch failed')) {
      console.error('Cannot connect to Supervisor. Is it running?');
      console.error(`URL: ${process.env['WANMAN_URL'] || 'http://localhost:3120'}`);
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  }
}

export function isDirectCliExecution(metaUrl = import.meta.url, argv = process.argv): boolean {
  const entry = argv[1]
  if (!entry) return false

  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(metaUrl))
  } catch {
    return false
  }
}

if (isDirectCliExecution()) {
  const [command, ...args] = process.argv.slice(2);
  run(command, args);
}
