import { spawnClaudeCode } from './claude-code.js';
import type { AgentAdapter, AgentRunHandle, AgentRunOptions } from './agent-adapter.js';

export class ClaudeAdapter implements AgentAdapter {
  readonly runtime = 'claude' as const;

  startRun(opts: AgentRunOptions): AgentRunHandle {
    return spawnClaudeCode({
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      cwd: opts.cwd,
      initialMessage: opts.initialMessage,
      sessionId: opts.sessionId,
      env: opts.env,
      runAsUser: opts.runAsUser,
    });
  }
}
