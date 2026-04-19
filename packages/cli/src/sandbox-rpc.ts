import type { Sandbox } from '@sandbank.dev/core'

export async function sandboxRpc<T>(
  sandbox: Sandbox,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  const escaped = body.replace(/'/g, "'\\''")
  const result = await sandbox.exec(
    `curl -sf -X POST http://localhost:3120/rpc -H 'Content-Type: application/json' -d '${escaped}'`,
  )
  if (result.exitCode !== 0) throw new Error(`RPC failed: ${result.stderr || result.stdout}`)
  const resp = JSON.parse(result.stdout) as { result?: T; error?: { message: string } }
  if (resp.error) throw new Error(resp.error.message)
  return resp.result as T
}
