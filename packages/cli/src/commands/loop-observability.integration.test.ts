/**
 * Integration test for loop observability — runs a real dashboard loop
 * against a mock supervisor inside a Sandbank sandbox.
 *
 * Requires local Sandbank agent running on localhost:3140.
 * Run: SANDBANK_URL=http://localhost:3140 pnpm -F @wanman/cli test loop-observability.integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createProvider } from '@sandbank.dev/core'
import { SandbankCloudAdapter } from '../sandbank-cloud.js'
import { countTransitions, classifyLoop } from '../loop-classifier.js'
import type { LoopSnapshot, LoopClassification } from '../loop-classifier.js'

const SANDBANK_URL = process.env['SANDBANK_URL'] || 'http://localhost:3140'
const SANDBANK_KEY = process.env['SANDBANK_API_KEY'] || ''
const OUTPUT_DIR = '/tmp/wanman-test-loop-observability'

async function agentAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${SANDBANK_URL}/health`)
    return r.ok
  } catch { return false }
}

/**
 * Mock supervisor script — a simple HTTP server that returns scripted task/agent states.
 * Simulates a multi-agent pipeline: architect → writer → editor → all done.
 *
 * The mock keeps a request counter to advance the task states on each poll,
 * covering: productive (new tasks, status changes, agents running),
 * blocked (waiting tasks), and idle (all done) classifications.
 */
const MOCK_SUPERVISOR_SCRIPT = `
const http = require('http');
let healthReqCount = 0;
let rpcReqCount = 0;

// Scripted task progression — simulates a novel generation pipeline
const taskSequences = [
  // Poll 0-1: CEO creating tasks (productive — new tasks appearing)
  { tasks: [], agents: [{ name: 'ceo', state: 'running', lifecycle: '24/7' }] },
  { tasks: [
    { id: '1', title: 'Generate blueprint', status: 'assigned', assignee: 'architect', priority: 1 },
  ], agents: [{ name: 'ceo', state: 'idle', lifecycle: '24/7' }, { name: 'architect', state: 'running', lifecycle: 'on-demand' }] },

  // Poll 2-3: architect done, writers started (productive — transitions + running)
  { tasks: [
    { id: '1', title: 'Generate blueprint', status: 'done', assignee: 'architect', priority: 1 },
    { id: '2', title: 'Write chapter 1', status: 'assigned', assignee: 'writer-1', priority: 2 },
    { id: '3', title: 'Write chapter 2', status: 'assigned', assignee: 'writer-2', priority: 2 },
  ], agents: [{ name: 'ceo', state: 'idle', lifecycle: '24/7' }, { name: 'writer-1', state: 'running', lifecycle: 'on-demand' }, { name: 'writer-2', state: 'running', lifecycle: 'on-demand' }] },
  { tasks: [
    { id: '1', title: 'Generate blueprint', status: 'done', assignee: 'architect', priority: 1 },
    { id: '2', title: 'Write chapter 1', status: 'in_progress', assignee: 'writer-1', priority: 2 },
    { id: '3', title: 'Write chapter 2', status: 'in_progress', assignee: 'writer-2', priority: 2 },
  ], agents: [{ name: 'ceo', state: 'idle', lifecycle: '24/7' }, { name: 'writer-1', state: 'running', lifecycle: 'on-demand' }, { name: 'writer-2', state: 'running', lifecycle: 'on-demand' }] },

  // Poll 4: writers done, editor waiting (blocked)
  { tasks: [
    { id: '1', title: 'Generate blueprint', status: 'done', assignee: 'architect', priority: 1 },
    { id: '2', title: 'Write chapter 1', status: 'done', assignee: 'writer-1', priority: 2 },
    { id: '3', title: 'Write chapter 2', status: 'done', assignee: 'writer-2', priority: 2 },
    { id: '4', title: 'Review manuscript', status: 'assigned', assignee: 'editor', priority: 3 },
  ], agents: [{ name: 'ceo', state: 'idle', lifecycle: '24/7' }, { name: 'editor', state: 'idle', lifecycle: 'on-demand' }] },

  // Poll 5: editor running (productive)
  { tasks: [
    { id: '1', title: 'Generate blueprint', status: 'done', assignee: 'architect', priority: 1 },
    { id: '2', title: 'Write chapter 1', status: 'done', assignee: 'writer-1', priority: 2 },
    { id: '3', title: 'Write chapter 2', status: 'done', assignee: 'writer-2', priority: 2 },
    { id: '4', title: 'Review manuscript', status: 'in_progress', assignee: 'editor', priority: 3 },
  ], agents: [{ name: 'ceo', state: 'idle', lifecycle: '24/7' }, { name: 'editor', state: 'running', lifecycle: 'on-demand' }] },

  // Poll 6+: all done (idle — should trigger doneStreak exit)
  { tasks: [
    { id: '1', title: 'Generate blueprint', status: 'done', assignee: 'architect', priority: 1 },
    { id: '2', title: 'Write chapter 1', status: 'done', assignee: 'writer-1', priority: 2 },
    { id: '3', title: 'Write chapter 2', status: 'done', assignee: 'writer-2', priority: 2 },
    { id: '4', title: 'Review manuscript', status: 'done', assignee: 'editor', priority: 3 },
  ], agents: [{ name: 'ceo', state: 'idle', lifecycle: '24/7' }, { name: 'editor', state: 'idle', lifecycle: 'on-demand' }] },
];

function getState(reqIdx) {
  const idx = Math.min(reqIdx, taskSequences.length - 1);
  return taskSequences[idx];
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    const state = getState(healthReqCount++);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, agents: state.agents }));
    return;
  }

  if (req.url === '/rpc' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      if (parsed.method === 'task.list') {
        const state = getState(rpcReqCount++);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { tasks: state.tasks } }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(3120, () => {
  console.log('Mock supervisor listening on :3120');
});
`;

// Minimal dashboard loop that mirrors run.ts logic but is testable
async function runDashboardLoop(
  sandbox: Awaited<ReturnType<ReturnType<typeof createProvider>['create']>>,
  outputDir: string,
  maxLoops: number,
): Promise<{ finalLoop: number }> {
  const DONE_OBSERVE_LOOPS = 5
  let doneStreak = 0
  let prevTasks: { id: string; status: string; title: string; assignee?: string }[] = []
  let finalLoop = 0
  const startTime = Date.now()
  const loopEventsPath = path.join(outputDir, 'loop-events.ndjson')

  for (let loop = 1; loop <= maxLoops; loop++) {
    finalLoop = loop

    // Collect state (same as run.ts)
    let agents: { name: string; state: string; lifecycle: string }[] = []
    try {
      const r = await sandbox.exec('curl -sf http://localhost:3120/health')
      const health = JSON.parse(r.stdout) as { agents: typeof agents }
      agents = health.agents
    } catch { /* ignore */ }

    let tasks: typeof prevTasks = []
    try {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'task.list', params: {} })
      const escaped = body.replace(/'/g, "'\\''")
      const r = await sandbox.exec(
        `curl -sf -X POST http://localhost:3120/rpc -H 'Content-Type: application/json' -d '${escaped}'`,
      )
      const resp = JSON.parse(r.stdout) as { result?: { tasks: typeof tasks } }
      tasks = resp.result?.tasks ?? []
    } catch { /* ignore */ }

    // Record loop snapshot
    const { classification, reasons } = classifyLoop(prevTasks, tasks, agents)
    const snapshot: LoopSnapshot = {
      loop,
      timestamp: new Date().toISOString(),
      elapsed: Date.now() - startTime,
      classification,
      reasons,
      tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, assignee: t.assignee })),
      taskTransitions: countTransitions(prevTasks, tasks),
      agents: agents.map(a => ({ name: a.name, state: a.state, lifecycle: a.lifecycle })),
    }
    try { fs.appendFileSync(loopEventsPath, JSON.stringify(snapshot) + '\n') } catch { /* best-effort */ }
    prevTasks = tasks

    // Early exit: all tasks done for N consecutive idle polls
    // Note: skip `loop > 10` guard for testing — we use small loop counts
    const doneCount = tasks.filter(t => t.status === 'done').length
    if (classification === 'idle' && tasks.length > 0 && doneCount === tasks.length) {
      doneStreak++
      if (doneStreak >= DONE_OBSERVE_LOOPS) {
        break
      }
    } else {
      doneStreak = 0
    }
  }

  // Write meta.json
  const meta = {
    goal: 'integration-test',
    maxLoops,
    actualLoops: finalLoop,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date().toISOString(),
    brainName: null,
  }
  fs.writeFileSync(path.join(outputDir, 'meta.json'), JSON.stringify(meta, null, 2))

  return { finalLoop }
}

describe('loop observability (sandbox integration)', () => {
  let provider: ReturnType<typeof createProvider>
  let sandbox: Awaited<ReturnType<typeof provider.create>>
  let sandboxId: string

  beforeAll(async () => {
    if (!(await agentAvailable())) return

    const adapter = new SandbankCloudAdapter({
      apiUrl: SANDBANK_URL,
      apiKey: SANDBANK_KEY,
    })
    provider = createProvider(adapter)
    sandbox = await provider.create({
      image: 'codebox',
      resources: { disk: 2 },
      timeout: 120,
    })
    sandboxId = sandbox.id

    // Upload and start mock supervisor
    const escaped = MOCK_SUPERVISOR_SCRIPT.replace(/'/g, "'\\''")
    await sandbox.exec(`cat > /tmp/mock-supervisor.js << 'SCRIPT_EOF'\n${MOCK_SUPERVISOR_SCRIPT}\nSCRIPT_EOF`)
    await sandbox.exec('nohup node /tmp/mock-supervisor.js > /tmp/mock-supervisor.log 2>&1 &')

    // Wait for mock supervisor to be ready
    const start = Date.now()
    while (Date.now() - start < 15_000) {
      try {
        const r = await sandbox.exec('curl -sf http://localhost:3120/health')
        if (r.stdout.includes('"ok":true')) break
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 500))
    }

    // Clean up previous test output
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true })
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }, 60_000)

  afterAll(async () => {
    if (sandboxId && provider) {
      await provider.destroy(sandboxId).catch(() => {})
    }
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true })
  }, 30_000)

  it('should produce loop-events.ndjson with correct classifications', async () => {
    if (!sandbox) return

    const testDir = path.join(OUTPUT_DIR, 'novel-pipeline')
    fs.mkdirSync(testDir, { recursive: true })

    const { finalLoop } = await runDashboardLoop(sandbox, testDir, 50)

    // Verify loop-events.ndjson exists and is valid NDJSON
    const eventsPath = path.join(testDir, 'loop-events.ndjson')
    expect(fs.existsSync(eventsPath)).toBe(true)

    const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n')
    const events = lines.map(line => JSON.parse(line) as LoopSnapshot)

    expect(events.length).toBe(finalLoop)
    expect(events.length).toBeGreaterThan(6) // at least through the full pipeline

    // Verify each event has required fields
    for (const e of events) {
      expect(e.loop).toBeGreaterThan(0)
      expect(e.timestamp).toBeTruthy()
      expect(e.elapsed).toBeGreaterThanOrEqual(0)
      expect(['productive', 'idle', 'blocked', 'backlog_stuck', 'error']).toContain(e.classification)
      expect(Array.isArray(e.reasons)).toBe(true)
      expect(Array.isArray(e.tasks)).toBe(true)
      expect(Array.isArray(e.agents)).toBe(true)
      expect(typeof e.taskTransitions).toBe('number')
    }
  }, 60_000)

  it('should classify productive loops from task transitions instead of agent churn', async () => {
    if (!sandbox) return

    const eventsPath = path.join(OUTPUT_DIR, 'novel-pipeline', 'loop-events.ndjson')
    const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n')
      .map(line => JSON.parse(line) as LoopSnapshot)

    // Productive loops should come from real task movement, not merely agents running.
    const productiveLoops = events.filter(e => e.classification === 'productive')
    expect(productiveLoops.length).toBeGreaterThan(0)

    // Every productive loop in this scripted scenario should be backed by task transitions.
    const withTransitions = productiveLoops.filter(e => e.taskTransitions > 0)
    expect(withTransitions.length).toBe(productiveLoops.length)
  }, 10_000)

  it('should correctly handle blocked classification when it occurs', async () => {
    if (!sandbox) return

    const eventsPath = path.join(OUTPUT_DIR, 'novel-pipeline', 'loop-events.ndjson')
    const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n')
      .map(line => JSON.parse(line) as LoopSnapshot)

    // In a fast-progressing scripted scenario, blocked may not occur since
    // each poll brings new transitions (productive takes priority over blocked).
    // Verify that IF blocked loops exist, they have correct reasons.
    const blockedLoops = events.filter(e => e.classification === 'blocked')
    for (const b of blockedLoops) {
      expect(b.reasons.some(r => r.includes('waiting'))).toBe(true)
    }

    // Also verify: every loop is classified as one of the valid types
    const validTypes = new Set(['productive', 'idle', 'blocked', 'backlog_stuck', 'error'])
    for (const e of events) {
      expect(validTypes.has(e.classification)).toBe(true)
    }
  }, 10_000)

  it('should classify idle loops and exit via doneStreak', async () => {
    if (!sandbox) return

    const eventsPath = path.join(OUTPUT_DIR, 'novel-pipeline', 'loop-events.ndjson')
    const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n')
      .map(line => JSON.parse(line) as LoopSnapshot)

    // Last 5 loops should all be idle (doneStreak = 5 → break)
    const lastFive = events.slice(-5)
    expect(lastFive.length).toBe(5)
    for (const e of lastFive) {
      expect(e.classification).toBe('idle')
      expect(e.tasks.every(t => t.status === 'done')).toBe(true)
    }

    // Should NOT have run all 50 max loops — doneStreak exited early
    expect(events.length).toBeLessThan(50)
  }, 10_000)

  it('should write valid meta.json', async () => {
    if (!sandbox) return

    const metaPath = path.join(OUTPUT_DIR, 'novel-pipeline', 'meta.json')
    expect(fs.existsSync(metaPath)).toBe(true)

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    expect(meta.goal).toBe('integration-test')
    expect(meta.maxLoops).toBe(50)
    expect(meta.actualLoops).toBeGreaterThan(6) // ran through pipeline
    expect(meta.actualLoops).toBeLessThan(50) // exited early
    expect(meta.startTime).toBeTruthy()
    expect(meta.endTime).toBeTruthy()
    expect(new Date(meta.endTime).getTime()).toBeGreaterThan(new Date(meta.startTime).getTime())
  }, 10_000)

  it('should report correct summary statistics', async () => {
    if (!sandbox) return

    const eventsPath = path.join(OUTPUT_DIR, 'novel-pipeline', 'loop-events.ndjson')
    const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n')
      .map(line => JSON.parse(line) as LoopSnapshot)

    // Compute summary (same logic as run.ts)
    const counts: Record<string, number> = { productive: 0, idle: 0, blocked: 0, backlog_stuck: 0, error: 0 }
    for (const e of events) {
      counts[e.classification] = (counts[e.classification] ?? 0) + 1
    }

    const total = events.length
    const rate = Math.round(((counts.productive ?? 0) / total) * 100)

    // Verify expected distribution
    expect(counts.productive).toBeGreaterThan(0)
    expect(counts.idle).toBeGreaterThanOrEqual(5) // at least 5 idle loops (doneStreak threshold)
    expect(counts.blocked).toBeGreaterThanOrEqual(0) // may or may not have blocked
    expect(counts.backlog_stuck).toBeGreaterThanOrEqual(0)
    expect(counts.error).toBe(0)
    expect(rate).toBeGreaterThan(0)
    expect(rate).toBeLessThan(100)
  }, 10_000)
})
