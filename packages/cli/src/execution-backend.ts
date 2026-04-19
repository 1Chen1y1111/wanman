import type { Sandbox } from '@sandbank.dev/core'
import type { RuntimeClient } from './runtime-client.js'

export interface BackendLogChunk {
  lines: string[]
  cursor: number
}

export interface ExecutionBackend {
  kind: 'sandbox' | 'local'
  runtime: RuntimeClient
  endpoint: string
  entrypoint?: string
  sandbox?: Sandbox
  readLogs(cursor: number): Promise<BackendLogChunk>
  attachSignalForwarding(): () => void
  stop(force?: boolean): Promise<void>
  waitForExit(): Promise<void>
}

export function createSandboxExecutionBackend(
  sandbox: Sandbox,
  runtime: RuntimeClient,
  endpoint = 'http://localhost:3120',
): ExecutionBackend {
  return {
    kind: 'sandbox',
    runtime,
    endpoint,
    sandbox,
    async readLogs(cursor) {
      const countRes = await sandbox.exec("wc -l /tmp/supervisor.log 2>/dev/null | awk '{print $1}'")
      const totalLines = parseInt(countRes.stdout.trim() || '0', 10)
      if (totalLines <= cursor) return { lines: [], cursor }

      const newCount = totalLines - cursor
      const tailRes = await sandbox.exec(`tail -${newCount} /tmp/supervisor.log 2>/dev/null`)
      const lines = tailRes.stdout.trim().split('\n').filter(Boolean)
      return { lines, cursor: totalLines }
    },
    attachSignalForwarding() {
      return () => {}
    },
    async stop() {
      // Sandbox cleanup is still owned by the provider/session layer.
    },
    async waitForExit() {
      // Supervisor lifetime is tied to the sandbox; no separate wait surface yet.
    },
  }
}
