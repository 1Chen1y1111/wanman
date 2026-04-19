/**
 * Integration test for `wanman run` deliverable download.
 *
 * Requires local sandbank agent running on localhost:3140.
 * Run: SANDBANK_URL=http://localhost:3140 pnpm -F @wanman/cli test run.integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createProvider } from '@sandbank.dev/core'
import { SandbankCloudAdapter } from '../sandbank-cloud.js'

const SANDBANK_URL = process.env['SANDBANK_URL'] || 'http://localhost:3140'
const SANDBANK_KEY = process.env['SANDBANK_API_KEY'] || ''
const OUTPUT_DIR = '/tmp/wanman-test-deliverables'

// Skip if no local agent
async function agentAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${SANDBANK_URL}/health`)
    return r.ok
  } catch { return false }
}

describe('deliverable download', () => {
  let sandboxId: string
  let provider: ReturnType<typeof createProvider>
  let sandbox: Awaited<ReturnType<typeof provider.create>>

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

    // Create fake agent output files inside sandbox
    await sandbox.exec('mkdir -p /workspace/agents/marketing/output')
    await sandbox.exec('mkdir -p /workspace/agents/finance/output')
    await sandbox.exec('mkdir -p /workspace/agents/ceo')
    await sandbox.exec("echo '# Brand Design\\nCompany: TestCo' > /workspace/agents/marketing/output/brand-design.md")
    await sandbox.exec("echo '# Budget Plan\\nTotal: $100k' > /workspace/agents/finance/output/budget.md")
    await sandbox.exec("echo '# CEO Notes' > /workspace/agents/ceo/CLAUDE.md")

    // Clean up previous test output
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true })
  }, 60_000)

  afterAll(async () => {
    if (sandboxId && provider) {
      await provider.destroy(sandboxId).catch(() => {})
    }
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true })
  }, 30_000)

  it('should list output files in sandbox', async () => {
    if (!sandbox) return

    const result = await sandbox.exec(
      "find /workspace/agents -type f \\( -path '*/output/*' -o -name 'CLAUDE.md' \\) | sort",
    )
    const files = result.stdout.trim().split('\n').filter(Boolean)

    expect(files).toContain('/workspace/agents/marketing/output/brand-design.md')
    expect(files).toContain('/workspace/agents/finance/output/budget.md')
    expect(files).toContain('/workspace/agents/ceo/CLAUDE.md')
  })

  it('should download files via readFile', async () => {
    if (!sandbox) return

    const content = await sandbox.readFile('/workspace/agents/marketing/output/brand-design.md')
    const text = new TextDecoder().decode(content)

    expect(text).toContain('Brand Design')
    expect(text).toContain('TestCo')
  })

  it('should download entire workspace via tar archive', async () => {
    if (!sandbox) return

    const runDir = path.join(OUTPUT_DIR, 'test-archive')
    fs.mkdirSync(runDir, { recursive: true })

    // Download as tar archive (same as run.ts primary path)
    const { execSync } = await import('node:child_process')
    const archiveStream = await sandbox.downloadArchive('/workspace/agents')

    const chunks: Uint8Array[] = []
    const reader = archiveStream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const tarData = Buffer.concat(chunks)
    expect(tarData.length).toBeGreaterThan(0)

    const tarPath = path.join(runDir, '_archive.tar')
    fs.writeFileSync(tarPath, tarData)
    execSync(`tar xf '${tarPath}' -C '${runDir}'`, { stdio: 'pipe' })
    fs.rmSync(tarPath)

    // Verify extracted files exist (tar preserves directory structure)
    const extracted = execSync(`find '${runDir}' -type f -name '*.md' | sort`, { encoding: 'utf-8' }).trim()
    expect(extracted).toContain('brand-design.md')
    expect(extracted).toContain('budget.md')
    expect(extracted).toContain('CLAUDE.md')
  })

  it('should download per-file as fallback', async () => {
    if (!sandbox) return

    const runDir = path.join(OUTPUT_DIR, 'test-perfile')
    fs.mkdirSync(runDir, { recursive: true })

    // Per-file download (fallback path)
    const findResult = await sandbox.exec(
      "find /workspace/agents -type f \\( -path '*/output/*' -o -name 'CLAUDE.md' \\) 2>/dev/null | sort",
    )
    const files = findResult.stdout.trim().split('\n').filter(Boolean)

    let downloaded = 0
    for (const remotePath of files) {
      const relative = remotePath.replace(/^\/workspace\/agents\//, '')
      const localPath = path.join(runDir, relative)
      fs.mkdirSync(path.dirname(localPath), { recursive: true })

      const content = await sandbox.readFile(remotePath)
      fs.writeFileSync(localPath, content)
      downloaded++
    }

    expect(downloaded).toBe(3)

    const brandPath = path.join(runDir, 'marketing/output/brand-design.md')
    expect(fs.existsSync(brandPath)).toBe(true)
    expect(fs.readFileSync(brandPath, 'utf-8')).toContain('TestCo')
  })

  it('should handle empty workspace gracefully', async () => {
    if (!sandbox) return

    // Create a temp empty workspace
    await sandbox.exec('mkdir -p /tmp/empty-workspace')
    const result = await sandbox.exec(
      "find /tmp/empty-workspace -type f -path '*/output/*' 2>/dev/null",
    )
    const files = result.stdout.trim().split('\n').filter(Boolean)

    expect(files).toHaveLength(0)
  })
})
