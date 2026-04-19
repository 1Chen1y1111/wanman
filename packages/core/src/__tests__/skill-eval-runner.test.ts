import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseFrontmatter,
  parseEvalFile,
  validateEval,
  scanAgentEvals,
  validateAllEvals,
  formatEvalReport,
} from '../skill-eval-runner.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), `eval-runner-test-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true }) } catch { /* ignore */ }
})

function createEvalFile(agentName: string, evalName: string, content: string): string {
  const dir = join(tmpDir, agentName, 'evals')
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `${evalName}.eval.md`)
  writeFileSync(filePath, content)
  return filePath
}

const VALID_EVAL = `---
name: test-eval
type: capability
model: haiku
---
# Test: Description

## Input
Agent receives a task.

## Expected Behavior
1. Does something

## Success Criteria
- [ ] Does step 1
- [ ] Does step 2
- [ ] Produces output
`

describe('parseFrontmatter', () => {
  it('should parse valid frontmatter', () => {
    const fm = parseFrontmatter(VALID_EVAL)
    expect(fm).not.toBeNull()
    expect(fm!.name).toBe('test-eval')
    expect(fm!.type).toBe('capability')
    expect(fm!.model).toBe('haiku')
  })

  it('should return null for missing frontmatter', () => {
    expect(parseFrontmatter('# No frontmatter')).toBeNull()
  })

  it('should return null for frontmatter without required fields', () => {
    expect(parseFrontmatter('---\nfoo: bar\n---\n# Content')).toBeNull()
  })

  it('should parse preference type', () => {
    const fm = parseFrontmatter('---\nname: pref\ntype: preference\n---\n')
    expect(fm!.type).toBe('preference')
  })
})

describe('parseEvalFile', () => {
  it('should parse a valid eval file', () => {
    const filePath = createEvalFile('ceo', 'task-decomp', VALID_EVAL)
    const result = parseEvalFile(filePath, 'ceo')

    expect(result).not.toBeNull()
    expect(result!.agentName).toBe('ceo')
    expect(result!.hasInput).toBe(true)
    expect(result!.hasExpectedBehavior).toBe(true)
    expect(result!.hasSuccessCriteria).toBe(true)
    expect(result!.criteria).toHaveLength(3)
    expect(result!.criteria[0]).toBe('Does step 1')
  })

  it('should extract wanman commands', () => {
    const content = VALID_EVAL + '\n`wanman task create` and `wanman send ceo`\n'
    const filePath = createEvalFile('ceo', 'with-cmds', content)
    const result = parseEvalFile(filePath, 'ceo')

    expect(result!.referencedCommands).toContain('task create')
    expect(result!.referencedCommands).toContain('send ceo')
  })

  it('should return null for files without frontmatter', () => {
    const filePath = createEvalFile('ceo', 'no-fm', '# No frontmatter here')
    expect(parseEvalFile(filePath, 'ceo')).toBeNull()
  })
})

describe('validateEval', () => {
  it('should pass a valid eval', () => {
    const filePath = createEvalFile('ceo', 'valid', VALID_EVAL)
    const parsed = parseEvalFile(filePath, 'ceo')!
    const result = validateEval(parsed)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should fail when missing Input section', () => {
    const content = VALID_EVAL.replace('## Input', '## Setup')
    const filePath = createEvalFile('ceo', 'no-input', content)
    const parsed = parseEvalFile(filePath, 'ceo')!
    const result = validateEval(parsed)

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Input'))).toBe(true)
  })

  it('should fail when missing Expected Behavior section', () => {
    const content = VALID_EVAL.replace('## Expected Behavior', '## Steps')
    const filePath = createEvalFile('ceo', 'no-expected', content)
    const parsed = parseEvalFile(filePath, 'ceo')!
    const result = validateEval(parsed)

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Expected Behavior'))).toBe(true)
  })

  it('should warn when fewer than 2 criteria', () => {
    const content = VALID_EVAL.replace('- [ ] Does step 2\n- [ ] Produces output\n', '')
    const filePath = createEvalFile('ceo', 'few-criteria', content)
    const parsed = parseEvalFile(filePath, 'ceo')!
    const result = validateEval(parsed)

    expect(result.valid).toBe(true) // warnings don't fail
    expect(result.warnings.some(w => w.includes('Fewer than 2'))).toBe(true)
  })
})

describe('scanAgentEvals', () => {
  it('should find all eval files for an agent', () => {
    createEvalFile('ceo', 'eval-1', VALID_EVAL)
    createEvalFile('ceo', 'eval-2', VALID_EVAL.replace('test-eval', 'eval-2'))

    const evals = scanAgentEvals(join(tmpDir, 'ceo'), 'ceo')
    expect(evals).toHaveLength(2)
  })

  it('should return empty for agent without evals', () => {
    mkdirSync(join(tmpDir, 'empty-agent'), { recursive: true })
    expect(scanAgentEvals(join(tmpDir, 'empty-agent'), 'empty-agent')).toHaveLength(0)
  })
})

describe('validateAllEvals', () => {
  it('should validate evals across multiple agents', () => {
    createEvalFile('ceo', 'task-decomp', VALID_EVAL)
    createEvalFile('dev', 'bug-fix', VALID_EVAL.replace('test-eval', 'bug-fix'))
    createEvalFile('finance', 'budget', VALID_EVAL.replace('test-eval', 'budget'))

    const results = validateAllEvals(tmpDir)
    expect(results).toHaveLength(3)
    expect(results.every(r => r.valid)).toBe(true)
  })

  it('should return empty for nonexistent directory', () => {
    expect(validateAllEvals('/nonexistent')).toEqual([])
  })
})

describe('formatEvalReport', () => {
  it('should format results correctly', () => {
    const results = [
      { agentName: 'ceo', evalName: 'task-decomp', filePath: '/tmp/x', valid: true, errors: [], warnings: [] },
      { agentName: 'dev', evalName: 'bug-fix', filePath: '/tmp/y', valid: false, errors: ['Missing Input'], warnings: [] },
    ]
    const report = formatEvalReport(results)

    expect(report).toContain('✅')
    expect(report).toContain('❌')
    expect(report).toContain('1 passed')
    expect(report).toContain('1 failed')
    expect(report).toContain('Missing Input')
  })
})

describe('E2E: validate real agent evals', () => {
  const AGENTS_DIR = join(__dirname, '..', '..', 'agents')

  it('should find 21 eval files across 7 agents', () => {
    const results = validateAllEvals(AGENTS_DIR)
    expect(results.length).toBe(21)
  })

  it('should pass validation for all 21 evals', () => {
    const results = validateAllEvals(AGENTS_DIR)
    const failed = results.filter(r => !r.valid)
    if (failed.length > 0) {
      console.log('Failed evals:', failed.map(f => `${f.agentName}/${f.evalName}: ${f.errors.join(', ')}`))
    }
    expect(failed).toHaveLength(0)
  })

  it('each eval should have at least 2 success criteria', () => {
    const results = validateAllEvals(AGENTS_DIR)
    const withFewCriteria = results.filter(r => r.warnings.some(w => w.includes('Fewer than 2')))
    expect(withFewCriteria).toHaveLength(0)
  })
})
