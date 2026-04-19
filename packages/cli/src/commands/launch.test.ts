import { beforeEach, describe, expect, it, vi } from 'vitest'
import { launchCommand } from './launch.js'

const mockedFetch = vi.fn<typeof fetch>()

vi.stubGlobal('fetch', mockedFetch)

describe('launch command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    process.env['WANMAN_API_URL'] = 'https://api.wanman.test'
    process.env['WANMAN_API_TOKEN'] = 'token-123'
  })

  it('lists launches through the shared launch api client', async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({
      launches: [
        {
          id: 'launch-1',
          user_id: 'user-1',
          kind: 'run',
          status: 'queued',
          mode: 'sandbox',
          runtime: 'claude',
          goal: 'Ship it',
          repo_url: null,
          repo_ref: null,
          output_path: null,
          error: null,
          payload: { goal: 'Ship it' },
          attempt_count: 0,
          max_attempts: 3,
          created_at: 1,
          updated_at: 1,
          heartbeat_at: null,
          started_at: null,
          completed_at: null,
        },
      ],
    }), { status: 200 }))

    await launchCommand(['list'])

    expect(mockedFetch).toHaveBeenCalledWith('https://api.wanman.test/api/launches', expect.objectContaining({
      method: undefined,
      headers: expect.objectContaining({
        Authorization: 'Bearer token-123',
      }),
    }))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"launch-1"'))
  })

  it('gets a launch detail projection', async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({
      launch: {
        id: 'launch-1',
        user_id: 'user-1',
        kind: 'takeover',
        status: 'running',
        mode: 'sandbox',
        runtime: 'codex',
        goal: null,
        repo_url: 'https://github.com/acme/repo',
        repo_ref: 'main',
        output_path: null,
        error: null,
        payload: { repo_url: 'https://github.com/acme/repo', repo_ref: 'main' },
        attempt_count: 1,
        max_attempts: 3,
        created_at: 1,
        updated_at: 2,
        heartbeat_at: 2,
        started_at: 1,
        completed_at: null,
        timeline: [],
      },
    }), { status: 200 }))

    await launchCommand(['get', 'launch-1'])

    expect(mockedFetch).toHaveBeenCalledWith('https://api.wanman.test/api/launches/launch-1', expect.any(Object))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"repo_url": "https://github.com/acme/repo"'))
  })

  it('creates a run launch', async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({
      launch: { id: 'launch-2', kind: 'run', status: 'queued' },
    }), { status: 200 }))

    await launchCommand(['run', 'Create', 'a', 'status', 'note'])

    expect(mockedFetch).toHaveBeenCalledWith('https://api.wanman.test/api/launches/run', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ goal: 'Create a status note' }),
    }))
  })

  it('cancels a queued launch', async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({
      launch: { id: 'launch-2', status: 'cancelled' },
    }), { status: 200 }))

    await launchCommand(['cancel', 'launch-2'])

    expect(mockedFetch).toHaveBeenCalledWith('https://api.wanman.test/api/launches/launch-2/cancel', expect.objectContaining({
      method: 'POST',
    }))
  })

  it('creates a takeover launch with ref, goal override, and repo auth mode', async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({
      launch: { id: 'launch-3', kind: 'takeover', status: 'queued' },
    }), { status: 200 }))

    await launchCommand([
      'takeover',
      'https://github.com/acme/repo',
      '--ref',
      'main',
      '--goal',
      'Stabilize release',
      '--repo-auth',
      'runner-env',
    ])

    expect(mockedFetch).toHaveBeenCalledWith('https://api.wanman.test/api/launches/takeover', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        repo_url: 'https://github.com/acme/repo',
        repo_ref: 'main',
        goal_override: 'Stabilize release',
        repo_auth: 'runner_env',
        github_installation_id: null,
      }),
    }))
  })

  it('creates a GitHub App-backed takeover launch with an installation id', async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({
      launch: { id: 'launch-4', kind: 'takeover', status: 'queued' },
    }), { status: 200 }))

    await launchCommand([
      'takeover',
      'https://github.com/acme/private-repo',
      '--repo-auth',
      'github-app',
      '--installation-id',
      '42',
    ])

    expect(mockedFetch).toHaveBeenCalledWith('https://api.wanman.test/api/launches/takeover', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        repo_url: 'https://github.com/acme/private-repo',
        repo_ref: null,
        goal_override: null,
        repo_auth: 'github_app',
        github_installation_id: 42,
      }),
    }))
  })

  it('watches a launch through the shared stream parser and runtime', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode([
          'event: launch',
          'data: {"id":"launch-1","status":"completed","timeline":[{"id":1},{"id":2}]}',
          '',
        ].join('\n')))
        controller.close()
      },
    })

    mockedFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        launch: {
          id: 'launch-1',
          user_id: 'user-1',
          kind: 'run',
          status: 'running',
          mode: 'sandbox',
          runtime: 'claude',
          goal: 'Ship it',
          repo_url: null,
          repo_ref: null,
          output_path: null,
          error: null,
          payload: { goal: 'Ship it' },
          attempt_count: 1,
          max_attempts: 3,
          created_at: 1,
          updated_at: 2,
          heartbeat_at: 2,
          started_at: 1,
          completed_at: null,
          timeline: [{ id: 1 }],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
        },
      }))

    await launchCommand(['watch', 'launch-1'])

    expect(mockedFetch).toHaveBeenNthCalledWith(1, 'https://api.wanman.test/api/launches/launch-1', expect.any(Object))
    expect(mockedFetch).toHaveBeenNthCalledWith(2, 'https://api.wanman.test/api/launches/launch-1/stream', {
      headers: {
        Accept: 'text/event-stream',
        Authorization: 'Bearer token-123',
      },
      signal: undefined,
    })
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"eventType": "snapshot"'))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"launchStatus": "completed"'))
  })

  it('fails fast when launch api credentials are missing', async () => {
    delete process.env['WANMAN_API_URL']
    delete process.env['WANMAN_API_TOKEN']

    await expect(launchCommand(['list'])).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('WANMAN_API_URL and WANMAN_API_TOKEN are required for launch API commands.')
  })
})
