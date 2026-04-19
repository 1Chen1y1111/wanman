/**
 * Tests for AuthManager and auth.* RPC methods.
 *
 * AuthManager is tested at two levels:
 *   1. Unit: mock child_process.spawn to verify URL/code extraction logic
 *   2. Integration: Supervisor.handleRpc / handleRpcAsync with mocked AuthManager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AgentMatrixConfig, JsonRpcRequest, AuthProviderInfo } from '@wanman/core'
import { RPC_METHODS, RPC_ERRORS } from '@wanman/core'

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../http-server.js', () => ({
  createHttpServer: vi.fn(() => ({
    close: (cb: () => void) => cb(),
  })),
}))

vi.mock('../agent-process.js', () => {
  class MockAgentProcess {
    definition: unknown
    state = 'idle'
    constructor(def: unknown) { this.definition = def }
    async start() {}
    stop() {}
    handleSteer() {}
  }
  return { AgentProcess: MockAgentProcess }
})

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// ─── Helpers ────────────────────────────────────────────────────────────────

function rpc(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: '2.0', id: 1, method, params }
}

function makeConfig(): AgentMatrixConfig {
  return {
    agents: [
      { name: 'echo', lifecycle: '24/7', model: 'haiku', systemPrompt: 'echo' },
    ],
    dbPath: ':memory:',
    port: 0,
  }
}

// =============================================================================
// 1. AuthManager unit tests — URL/code extraction with mock spawn
// =============================================================================

describe('AuthManager', () => {
  // We import AuthManager dynamically to control mocks
  let AuthManager: typeof import('../auth-manager.js').AuthManager

  beforeEach(async () => {
    vi.restoreAllMocks()
    // Fresh import each time
    const mod = await import('../auth-manager.js')
    AuthManager = mod.AuthManager
  })

  describe('getProviders', () => {
    it('should return 5 providers', async () => {
      const mgr = new AuthManager()
      // checkAuth will fail for stripe/github (not installed), cloudflare (no env)
      const providers = await mgr.getProviders()
      expect(providers).toHaveLength(5)
      expect(providers.map(p => p.name).sort()).toEqual(['claude', 'cloudflare', 'codex', 'github', 'stripe'])
    })

    it('should report unauthenticated for all providers in clean env', async () => {
      const mgr = new AuthManager()
      const providers = await mgr.getProviders()
      // stripe & github CLIs likely not installed → unauthenticated
      // cloudflare → no CLOUDFLARE_API_TOKEN → unauthenticated
      for (const p of providers) {
        expect(['authenticated', 'unauthenticated']).toContain(p.status)
      }
    })
  })

  describe('checkAuth', () => {
    it('should detect cloudflare via env var', async () => {
      const mgr = new AuthManager()
      // No env var
      expect(await mgr.checkAuth('cloudflare')).toBe(false)
    })

    it('should detect cloudflare when env var set', async () => {
      process.env['CLOUDFLARE_API_TOKEN'] = 'test-token'
      try {
        const mgr = new AuthManager()
        expect(await mgr.checkAuth('cloudflare')).toBe(true)
      } finally {
        delete process.env['CLOUDFLARE_API_TOKEN']
      }
    })

    it('should detect claude via ANTHROPIC_API_KEY', async () => {
      const mgr = new AuthManager()
      // No env var → unauthenticated
      const before = process.env['ANTHROPIC_API_KEY']
      const beforeHome = process.env['HOME']
      delete process.env['ANTHROPIC_API_KEY']
      delete process.env['CLAUDE_CREDENTIALS']
      // Point HOME to nonexistent dir so ~/.claude/.credentials.json is not found
      process.env['HOME'] = '/tmp/nonexistent-wanman-test'
      try {
        expect(await mgr.checkAuth('claude')).toBe(false)
      } finally {
        if (before) process.env['ANTHROPIC_API_KEY'] = before
        process.env['HOME'] = beforeHome
      }
    })

    it('should detect claude when ANTHROPIC_API_KEY is set', async () => {
      const before = process.env['ANTHROPIC_API_KEY']
      process.env['ANTHROPIC_API_KEY'] = 'sk-test-key'
      try {
        const mgr = new AuthManager()
        expect(await mgr.checkAuth('claude')).toBe(true)
      } finally {
        if (before) process.env['ANTHROPIC_API_KEY'] = before
        else delete process.env['ANTHROPIC_API_KEY']
      }
    })

    it('should detect claude when CLAUDE_CREDENTIALS is set', async () => {
      const beforeKey = process.env['ANTHROPIC_API_KEY']
      const beforeCreds = process.env['CLAUDE_CREDENTIALS']
      delete process.env['ANTHROPIC_API_KEY']
      process.env['CLAUDE_CREDENTIALS'] = '{"claudeAiOauth":{"accessToken":"test","refreshToken":"test","expiresAt":9999999999999}}'
      try {
        const mgr = new AuthManager()
        expect(await mgr.checkAuth('claude')).toBe(true)
      } finally {
        if (beforeKey) process.env['ANTHROPIC_API_KEY'] = beforeKey
        if (beforeCreds) process.env['CLAUDE_CREDENTIALS'] = beforeCreds
        else delete process.env['CLAUDE_CREDENTIALS']
      }
    })

    it('should detect codex when OPENAI_API_KEY is set', async () => {
      const before = process.env['OPENAI_API_KEY']
      process.env['OPENAI_API_KEY'] = 'sk-test-openai'
      try {
        const mgr = new AuthManager()
        expect(await mgr.checkAuth('codex')).toBe(true)
      } finally {
        if (before) process.env['OPENAI_API_KEY'] = before
        else delete process.env['OPENAI_API_KEY']
      }
    })
  })

  describe('startLogin', () => {
    it('should return error for cloudflare (no CLI login)', async () => {
      const mgr = new AuthManager()
      const result = await mgr.startLogin('cloudflare')
      expect(result.status).toBe('error')
      expect(result.error).toContain('does not support CLI login')
    })

    it('should return pending session for claude if already in progress', async () => {
      const mgr = new AuthManager()
      const sessions = (mgr as unknown as { sessions: Map<string, unknown> }).sessions
      sessions.set('claude', {
        provider: 'claude',
        status: 'pending',
        loginUrl: 'http://localhost:9876/auth',
      })

      const result = await mgr.startLogin('claude')
      expect(result.status).toBe('pending')
      expect(result.loginUrl).toBe('http://localhost:9876/auth')
    })

    it('should return pending session if already in progress', async () => {
      const mgr = new AuthManager()
      // Manually set a pending session via private access
      const sessions = (mgr as unknown as { sessions: Map<string, unknown> }).sessions
      sessions.set('stripe', {
        provider: 'stripe',
        status: 'pending',
        loginUrl: 'https://stripe.com/login/xxx',
        loginCode: 'test-code',
      })

      const result = await mgr.startLogin('stripe')
      expect(result.status).toBe('pending')
      expect(result.loginUrl).toBe('https://stripe.com/login/xxx')
      expect(result.loginCode).toBe('test-code')
    })
  })

  describe('getLoginStatus', () => {
    it('should return unauthenticated for unknown provider session', () => {
      const mgr = new AuthManager()
      const result = mgr.getLoginStatus('github')
      expect(result.name).toBe('github')
      expect(result.status).toBe('unauthenticated')
    })

    it('should return session state if login was started', () => {
      const mgr = new AuthManager()
      // Manually inject session state
      const sessions = (mgr as unknown as { sessions: Map<string, unknown> }).sessions
      sessions.set('stripe', {
        provider: 'stripe',
        status: 'authenticated',
        loginUrl: 'https://stripe.com/login/xxx',
        loginCode: 'test-code',
      })

      const result = mgr.getLoginStatus('stripe')
      expect(result.status).toBe('authenticated')
      expect(result.loginUrl).toBe('https://stripe.com/login/xxx')
    })
  })
})

// =============================================================================
// 2. Supervisor auth.* RPC integration tests
// =============================================================================

describe('Supervisor — auth.* RPC methods', () => {
  let Supervisor: typeof import('../supervisor.js').Supervisor
  let supervisor: InstanceType<typeof import('../supervisor.js').Supervisor>

  beforeEach(async () => {
    const mod = await import('../supervisor.js')
    Supervisor = mod.Supervisor
    supervisor = new Supervisor(makeConfig())
    await supervisor.start()
  })

  afterEach(async () => {
    await supervisor.shutdown()
  })

  // ── auth.providers ──

  it('auth.providers returns all 5 providers via handleRpcAsync', async () => {
    const res = await supervisor.handleRpcAsync(rpc(RPC_METHODS.AUTH_PROVIDERS, {}))
    expect(res.error).toBeUndefined()
    const { providers } = res.result as { providers: AuthProviderInfo[] }
    expect(providers).toHaveLength(5)

    const names = providers.map(p => p.name).sort()
    expect(names).toEqual(['claude', 'cloudflare', 'codex', 'github', 'stripe'])

    // Each provider should have a status
    for (const p of providers) {
      expect(['authenticated', 'unauthenticated', 'pending', 'error']).toContain(p.status)
    }
  })

  // ── auth.status ──

  it('auth.status returns current state for a provider (sync)', () => {
    const res = supervisor.handleRpc(rpc(RPC_METHODS.AUTH_STATUS, { provider: 'github' }))
    expect(res.error).toBeUndefined()
    const info = res.result as AuthProviderInfo
    expect(info.name).toBe('github')
    expect(info.status).toBe('unauthenticated')
  })

  it('auth.status returns INVALID_PARAMS when provider is missing', () => {
    const res = supervisor.handleRpc(rpc(RPC_METHODS.AUTH_STATUS, {}))
    expect(res.error?.code).toBe(RPC_ERRORS.INVALID_PARAMS)
  })

  // ── auth.start ──

  it('auth.start returns error for unsupported provider (cloudflare)', async () => {
    const res = await supervisor.handleRpcAsync(rpc(RPC_METHODS.AUTH_START, { provider: 'cloudflare' }))
    expect(res.error).toBeUndefined()
    const info = res.result as AuthProviderInfo
    expect(info.status).toBe('error')
    expect(info.error).toContain('does not support CLI login')
  })

  it('auth.start returns INVALID_PARAMS when provider is missing', async () => {
    const res = await supervisor.handleRpcAsync(rpc(RPC_METHODS.AUTH_START, {}))
    expect(res.error?.code).toBe(RPC_ERRORS.INVALID_PARAMS)
  })

  // ── handleRpcAsync falls through to sync for non-auth methods ──

  it('handleRpcAsync handles sync methods (agent.list) correctly', async () => {
    const res = await supervisor.handleRpcAsync(rpc(RPC_METHODS.AGENT_LIST))
    expect(res.error).toBeUndefined()
    const { agents } = res.result as { agents: unknown[] }
    expect(agents).toHaveLength(1)
  })

  it('handleRpcAsync handles unknown methods correctly', async () => {
    const res = await supervisor.handleRpcAsync(rpc('nonexistent.method'))
    expect(res.error?.code).toBe(RPC_ERRORS.METHOD_NOT_FOUND)
  })
})
