import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCliLaunchRunner: vi.fn(),
}))

vi.mock('../launch-runner.js', () => ({
  createCliLaunchRunner: mocks.createCliLaunchRunner,
}))

import { launchRunnerCommand } from './launch-runner.js'

describe('launchRunnerCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['WANMAN_API_URL'] = 'https://api.example.com'
    process.env['WANMAN_RUNNER_SECRET'] = 'runner-secret'
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
  })

  it('runs the queue loop by default', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const runOnce = vi.fn().mockResolvedValue({ claimed: false })
    mocks.createCliLaunchRunner.mockReturnValue({ run, runOnce })

    await launchRunnerCommand([])

    expect(mocks.createCliLaunchRunner).toHaveBeenCalledWith(expect.objectContaining({
      apiBaseUrl: expect.any(String),
      runnerSecret: expect.any(String),
      once: false,
    }))
    expect(run).toHaveBeenCalled()
  })

  it('runs one launch when --once is provided', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const runOnce = vi.fn().mockResolvedValue({ claimed: false })
    mocks.createCliLaunchRunner.mockReturnValue({ run, runOnce })

    await launchRunnerCommand(['--once'])

    expect(runOnce).toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
})
