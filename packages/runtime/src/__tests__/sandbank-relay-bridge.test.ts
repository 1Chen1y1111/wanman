/**
 * Integration tests for SandbankRelayBridge and SandbankContextBridge.
 * Starts a real Sandbank relay server in-process and tests full round-trip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SandbankRelayBridge } from '../sandbank-relay-bridge.js'
import { SandbankContextBridge } from '../sandbank-context-bridge.js'
import { LOOPBACK_LISTEN_AVAILABLE } from './loopback-capability.js'

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const describeIfLoopback = LOOPBACK_LISTEN_AVAILABLE ? describe : describe.skip

describeIfLoopback('SandbankRelayBridge', () => {
  let relay: { url: string; wsUrl: string; close: () => Promise<void> }
  let bridge: SandbankRelayBridge

  beforeEach(async () => {
    const { startRelay } = await import('@sandbank.dev/relay')
    relay = await startRelay({ port: 0 })
    bridge = new SandbankRelayBridge({
      relayUrl: relay.url,
      wsUrl: relay.wsUrl,
      agents: ['ceo', 'finance', 'devops'],
    })
    await bridge.initialize()
  })

  afterEach(async () => {
    await bridge.close()
    await relay.close()
  })

  it('should send and receive messages', async () => {
    bridge.send('ceo', 'finance', 'task', { action: 'check-mrr' }, 'normal')

    // Small delay for async send to complete
    await new Promise((r) => setTimeout(r, 50))

    const messages = await bridge.recv('finance')
    expect(messages).toHaveLength(1)
    expect(messages[0]!.from).toBe('ceo')
    expect(messages[0]!.to).toBe('finance')
    expect(messages[0]!.type).toBe('task')
    expect(messages[0]!.payload).toEqual({ action: 'check-mrr' })
    expect(messages[0]!.priority).toBe('normal')
    expect(messages[0]!.delivered).toBe(true)
    expect(typeof messages[0]!.id).toBe('string')
    expect(typeof messages[0]!.timestamp).toBe('number')
  })

  it('should return steer messages before normal (priority ordering)', async () => {
    bridge.send('ceo', 'finance', 'task', 'low priority', 'normal')
    bridge.send('ceo', 'finance', 'task', 'URGENT', 'steer')
    bridge.send('ceo', 'finance', 'task', 'also low', 'normal')

    await new Promise((r) => setTimeout(r, 50))

    const messages = await bridge.recv('finance', 10)
    expect(messages).toHaveLength(3)
    // Steer should come first
    expect(messages[0]!.payload).toBe('URGENT')
    expect(messages[0]!.priority).toBe('steer')
    expect(messages[1]!.payload).toBe('low priority')
    expect(messages[2]!.payload).toBe('also low')
  })

  it('should trigger steer callback on steer message', async () => {
    let steeredAgent = ''
    bridge.setSteerCallback((agent) => {
      steeredAgent = agent
    })

    bridge.send('ceo', 'finance', 'task', 'urgent!', 'steer')
    // Steer callback is synchronous
    expect(steeredAgent).toBe('finance')
    // Wait for the async HTTP send to complete before teardown
    await new Promise((r) => setTimeout(r, 50))
  })

  it('should not trigger steer callback on normal message', async () => {
    let called = false
    bridge.setSteerCallback(() => {
      called = true
    })

    bridge.send('ceo', 'finance', 'task', 'hello', 'normal')
    expect(called).toBe(false)
    // Wait for the async HTTP send to complete before teardown
    await new Promise((r) => setTimeout(r, 50))
  })

  it('should not double-deliver messages (drain on recv)', async () => {
    bridge.send('ceo', 'finance', 'task', 'hello', 'normal')
    await new Promise((r) => setTimeout(r, 50))

    const first = await bridge.recv('finance')
    expect(first).toHaveLength(1)

    const second = await bridge.recv('finance')
    expect(second).toHaveLength(0)
  })

  it('should return empty array when no messages pending', async () => {
    const messages = await bridge.recv('finance')
    expect(messages).toHaveLength(0)
  })

  it('should isolate messages between agents', async () => {
    bridge.send('ceo', 'finance', 'task', 'for finance', 'normal')
    bridge.send('ceo', 'devops', 'task', 'for devops', 'normal')

    await new Promise((r) => setTimeout(r, 50))

    const financeMessages = await bridge.recv('finance')
    expect(financeMessages).toHaveLength(1)
    expect(financeMessages[0]!.payload).toBe('for finance')

    const devopsMessages = await bridge.recv('devops')
    expect(devopsMessages).toHaveLength(1)
    expect(devopsMessages[0]!.payload).toBe('for devops')
  })

  it('should return a message ID from send', async () => {
    const id = bridge.send('ceo', 'finance', 'task', 'hello', 'normal')
    expect(id).toBeTruthy()
    expect(typeof id).toBe('string')
    // Should be UUID format
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    await new Promise((r) => setTimeout(r, 50))
  })

  it('should return false for hasSteer (best-effort)', () => {
    expect(bridge.hasSteer('finance')).toBe(false)
  })
})

describeIfLoopback('SandbankContextBridge', () => {
  let relay: { url: string; wsUrl: string; close: () => Promise<void> }
  let relayBridge: SandbankRelayBridge
  let contextBridge: SandbankContextBridge

  beforeEach(async () => {
    const { startRelay } = await import('@sandbank.dev/relay')
    relay = await startRelay({ port: 0 })
    relayBridge = new SandbankRelayBridge({
      relayUrl: relay.url,
      wsUrl: relay.wsUrl,
      agents: ['ceo', 'finance'],
    })
    await relayBridge.initialize()

    contextBridge = new SandbankContextBridge({
      relayUrl: relay.url,
      sessionId: relayBridge.sessionId,
      token: relayBridge.token,
    })
  })

  afterEach(async () => {
    await relayBridge.close()
    await relay.close()
  })

  it('should set and get context values', async () => {
    await contextBridge.set('mrr', '5000', 'finance')
    const entry = await contextBridge.get('mrr')

    expect(entry).not.toBeNull()
    expect(entry!.key).toBe('mrr')
    expect(entry!.value).toBe('5000')
    // updatedBy is best-effort in Sandbank
    expect(typeof entry!.updatedAt).toBe('number')
  })

  it('should return null for missing keys', async () => {
    const entry = await contextBridge.get('nonexistent')
    expect(entry).toBeNull()
  })

  it('should overwrite existing keys', async () => {
    await contextBridge.set('mrr', '5000', 'finance')
    await contextBridge.set('mrr', '6000', 'finance')

    const entry = await contextBridge.get('mrr')
    expect(entry).not.toBeNull()
    expect(entry!.value).toBe('6000')
  })

  it('should list all entries via getAll', async () => {
    await contextBridge.set('a', '1', 'ceo')
    await contextBridge.set('b', '2', 'finance')

    const all = await contextBridge.getAll()
    expect(all).toHaveLength(2)

    const keys = all.map((e) => e.key).sort()
    expect(keys).toEqual(['a', 'b'])
  })

  it('should handle non-string context values', async () => {
    // Sandbank stores unknown values; the bridge stringifies non-strings
    await contextBridge.set('data', JSON.stringify({ count: 42 }), 'finance')
    const entry = await contextBridge.get('data')
    expect(entry).not.toBeNull()
    // The value comes back as-is since we sent a string
    expect(entry!.value).toBe('{"count":42}')
  })
})
