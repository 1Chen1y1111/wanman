/**
 * Sandbank Cloud adapter — implements @sandbank.dev/core SandboxAdapter
 * for the remote BoxLite Cloud REST API (cloud.sandbank.dev).
 *
 * Reference: vibelab's SandbankCloudSandboxManager
 */

import type {
  SandboxAdapter,
  AdapterSandbox,
  CreateConfig,
  ExecOptions,
  ExecResult,
  ListFilter,
  SandboxInfo,
  SandboxState,
  Capability,
} from '@sandbank.dev/core'

interface CloudConfig {
  apiUrl: string
  apiKey: string
  image?: string
}

export class SandbankCloudAdapter implements SandboxAdapter {
  readonly name = 'sandbank-cloud'
  readonly capabilities: ReadonlySet<Capability> = new Set(['snapshot', 'port.expose'])

  private baseUrl: string
  private apiKey: string
  private defaultImage: string

  constructor(config: CloudConfig) {
    this.baseUrl = config.apiUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.defaultImage = config.image ?? 'codebox'
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (body) headers['Content-Type'] = 'application/json'
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Sandbank Cloud ${method} ${path} → ${res.status}: ${text}`)
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      return await res.json() as T
    }
    return undefined as T
  }

  async createSandbox(config: CreateConfig): Promise<AdapterSandbox> {
    const body: Record<string, unknown> = {
      image: this.defaultImage,
      cpu: config.resources?.cpu ?? 2,
      memory_mb: (config.resources?.memory ?? 2) * 1024,
      disk_size_gb: config.resources?.disk ?? 5,
      timeout_minutes: config.autoDestroyMinutes ?? 30,
    }
    if (config.env) body['env'] = config.env
    if (config.ports) body['ports'] = config.ports

    const box = await this.api<{
      id: string
      status: string
      created_at: string
      ports?: Record<string, number>
    }>('POST', '/v1/boxes', body)

    return new CloudSandbox(this.baseUrl, this.apiKey, box.id, box.status as SandboxState, box.created_at)
  }

  async getSandbox(id: string): Promise<AdapterSandbox> {
    const box = await this.api<{
      id: string
      status: string
      created_at: string
    }>('GET', `/v1/boxes/${id}`)
    return new CloudSandbox(this.baseUrl, this.apiKey, box.id, box.status as SandboxState, box.created_at)
  }

  async listSandboxes(filter?: ListFilter): Promise<SandboxInfo[]> {
    const params = filter?.state ? `?status=${filter.state}` : ''
    const boxes = await this.api<Array<{
      id: string
      status: string
      created_at: string
      image: string
    }>>('GET', `/v1/boxes${params}`)
    return boxes.map(b => ({
      id: b.id,
      state: b.status as SandboxState,
      createdAt: b.created_at,
      image: b.image,
    }))
  }

  async cloneSandbox(sourceId: string): Promise<AdapterSandbox> {
    const box = await this.api<{
      id: string
      status: string
      created_at: string
    }>('POST', `/v1/boxes/${sourceId}/clone`)
    return new CloudSandbox(this.baseUrl, this.apiKey, box.id, box.status as SandboxState, box.created_at)
  }

  async destroySandbox(id: string): Promise<void> {
    await this.api('DELETE', `/v1/boxes/${id}`)
  }
}

class CloudSandbox implements AdapterSandbox {
  id: string
  state: SandboxState
  createdAt: string

  private baseUrl: string
  private apiKey: string

  constructor(baseUrl: string, apiKey: string, id: string, state: SandboxState, createdAt: string) {
    this.baseUrl = baseUrl
    this.apiKey = apiKey
    this.id = id
    this.state = state
    this.createdAt = createdAt
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (body) headers['Content-Type'] = 'application/json'
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Sandbank Cloud ${method} ${path} → ${res.status}: ${text}`)
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      return await res.json() as T
    }
    return undefined as T
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const timeoutSec = options?.timeout ? Math.ceil(options.timeout / 1000) : 300
    const result = await this.api<{
      exit_code: number
      stdout: string
      stderr: string
    }>('POST', `/v1/boxes/${this.id}/exec`, {
      cmd: ['bash', '-c', command],
      timeout_seconds: timeoutSec,
      working_dir: options?.cwd,
    })
    return {
      exitCode: result.exit_code,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }

  async writeFile(filePath: string, content: string | Uint8Array): Promise<void> {
    const text = typeof content === 'string' ? content : new TextDecoder().decode(content)
    const b64 = Buffer.from(text).toString('base64')
    const dir = filePath.substring(0, filePath.lastIndexOf('/'))
    if (dir) {
      await this.exec(`mkdir -p '${dir}'`)
    }
    await this.exec(`printf '%s' '${b64}' | base64 -d > '${filePath}'`)
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    const result = await this.exec(`base64 '${filePath}'`)
    if (result.exitCode !== 0) {
      throw new Error(`readFile failed: ${result.stderr}`)
    }
    return Buffer.from(result.stdout.trim(), 'base64')
  }

  async downloadArchive(srcDir?: string): Promise<ReadableStream> {
    const queryPath = encodeURIComponent(srcDir || '/')
    const headers: Record<string, string> = {}
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

    const res = await fetch(`${this.baseUrl}/v1/boxes/${this.id}/files?path=${queryPath}`, {
      method: 'GET',
      headers,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`downloadArchive failed: ${res.status} ${text}`)
    }
    return res.body as ReadableStream
  }
}
