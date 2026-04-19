import { describe, expect, it } from 'vitest'
import { LoopEventBus } from './loop-observability.js'

describe('LoopEventBus', () => {
  const agents = [
    { name: 'ceo', state: 'running', lifecycle: '24/7' },
    { name: 'dev', state: 'idle', lifecycle: 'on-demand' },
  ]

  it('treats running agents alone as idle', () => {
    const bus = new LoopEventBus('run-cli-test')
    bus.tick()

    const result = bus.classify(agents)
    expect(result.classification).toBe('idle')
    expect(result.reasons).toContain('no state changes detected')
  })

  it('classifies task transitions as productive', () => {
    const bus = new LoopEventBus('run-cli-test')
    bus.tick()
    bus.emit({
      type: 'task.transition',
      runId: 'run-cli-test',
      loop: 1,
      taskId: 1,
      from: 'assigned',
      to: 'done',
      timestamp: new Date().toISOString(),
    })

    const result = bus.classify(agents)
    expect(result.classification).toBe('productive')
    expect(result.reasons[0]).toContain('task transition')
  })

  it('classifies blocked tasks without relying on agent churn', () => {
    const bus = new LoopEventBus('run-cli-test')
    bus.tick()
    bus.emit({
      type: 'task.blocked',
      runId: 'run-cli-test',
      loop: 1,
      taskId: 9,
      waitingOn: [4],
      timestamp: new Date().toISOString(),
    })

    const result = bus.classify(agents)
    expect(result.classification).toBe('blocked')
    expect(result.reasons[0]).toContain('blocked by dependencies')
  })
})
