import { beforeEach, describe, expect, it, vi } from 'vitest'
import { storyCommand } from './story.js'

const mockedFetch = vi.fn<typeof fetch>()

vi.stubGlobal('fetch', mockedFetch)

describe('story command', () => {
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

  it('lists stories through the shared story api client', async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({
      stories: [
        {
          id: 'story-1',
          user_id: 'user-1',
          name: 'Launch',
          goal: 'Ship it',
          repo_url: null,
          status: 'running',
          mode: 'byos',
          provider: 'claude',
          sandbox_id: 'box-1',
          sandbox_url: null,
          run_id: 'run-1',
          config: null,
          started_at: 1,
          completed_at: null,
          created_at: 1,
          taskSummaries: [],
          artifactCount: 0,
          agentCount: 0,
          current_run: null,
        },
      ],
    }), { status: 200 }))

    await storyCommand(['list'])

    expect(mockedFetch).toHaveBeenCalledWith('https://api.wanman.test/api/stories', expect.objectContaining({
      method: undefined,
      headers: expect.objectContaining({
        Authorization: 'Bearer token-123',
      }),
    }))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"story-1"'))
  })

  it('requests the current run projection for a story', async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({
      current_run: {
        id: 'run-1',
        story_id: 'story-1',
        status: 'running',
        sandbox_id: 'box-1',
        sandbox_url: null,
        started_at: 1,
        completed_at: null,
        created_at: 1,
        updated_at: 2,
        timeline: [],
      },
    }), { status: 200 }))

    await storyCommand(['current-run', 'story-1'])

    expect(mockedFetch).toHaveBeenCalledWith('https://api.wanman.test/api/stories/story-1/runs/current', expect.any(Object))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"run-1"'))
  })

  it('watches a story through the shared stream parser and session reducer', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode([
          'event: run',
          'data: {"id":11,"story_id":"story-1","run_id":"run-1","event_type":"status.transition","status":"completed","actor":"runtime","payload":{"from":"running","to":"completed"},"created_at":3}',
          '',
        ].join('\n')))
        controller.close()
      },
    })

    mockedFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'story-1',
        user_id: 'user-1',
        name: 'Launch',
        goal: 'Ship it',
        repo_url: null,
        status: 'running',
        mode: 'byos',
        provider: 'claude',
        sandbox_id: 'box-1',
        sandbox_url: null,
        run_id: 'run-1',
        config: null,
        started_at: 1,
        completed_at: null,
        created_at: 1,
        artifacts: [],
        tasks: [],
        current_run: {
          id: 'run-1',
          story_id: 'story-1',
          status: 'running',
          sandbox_id: 'box-1',
          sandbox_url: null,
          started_at: 1,
          completed_at: null,
          created_at: 1,
          updated_at: 2,
          timeline: [],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
        },
      }))

    await storyCommand(['watch', 'story-1'])

    expect(mockedFetch).toHaveBeenNthCalledWith(1, 'https://api.wanman.test/api/stories/story-1', expect.any(Object))
    expect(mockedFetch).toHaveBeenNthCalledWith(2, 'https://api.wanman.test/api/stories/story-1/stream', {
      headers: {
        Accept: 'text/event-stream',
        Authorization: 'Bearer token-123',
      },
    })
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"eventType": "snapshot"'))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"storyStatus": "completed"'))
  })

  it('fails fast when story api credentials are missing', async () => {
    delete process.env['WANMAN_API_URL']
    delete process.env['WANMAN_API_TOKEN']

    await expect(storyCommand(['list'])).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('WANMAN_API_URL and WANMAN_API_TOKEN are required for story API commands.')
  })
})
