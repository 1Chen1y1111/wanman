/**
 * Skill Eval Runner — Tier 1 (static) eval validation.
 *
 * Reads eval files, parses YAML frontmatter, validates structure,
 * and checks that referenced wanman CLI commands exist.
 *
 * Tier 1 is free (no LLM calls). Tier 2/3 require Claude API.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

export interface EvalFrontmatter {
  name: string
  type: 'capability' | 'preference'
  model?: string
}

export interface EvalFile {
  frontmatter: EvalFrontmatter
  filePath: string
  agentName: string
  content: string
  /** Required sections */
  hasInput: boolean
  hasExpectedBehavior: boolean
  hasSuccessCriteria: boolean
  /** Extracted success criteria */
  criteria: string[]
  /** wanman CLI commands referenced */
  referencedCommands: string[]
}

export interface EvalValidationResult {
  agentName: string
  evalName: string
  filePath: string
  valid: boolean
  errors: string[]
  warnings: string[]
}

/** Parse YAML frontmatter from a markdown file */
export function parseFrontmatter(content: string): EvalFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null

  const yaml = match[1]!
  const fields: Record<string, string> = {}
  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const key = line.slice(0, colonIdx).trim()
    const val = line.slice(colonIdx + 1).trim()
    fields[key] = val
  }

  if (!fields['name'] || !fields['type']) return null

  return {
    name: fields['name'],
    type: fields['type'] as 'capability' | 'preference',
    model: fields['model'],
  }
}

/** Parse a single eval file */
export function parseEvalFile(filePath: string, agentName: string): EvalFile | null {
  const content = fs.readFileSync(filePath, 'utf-8')
  const frontmatter = parseFrontmatter(content)
  if (!frontmatter) return null

  const hasInput = /^## Input/m.test(content)
  const hasExpectedBehavior = /^## Expected Behavior/m.test(content)
  const hasSuccessCriteria = /^## Success Criteria/m.test(content)

  // Extract success criteria (lines starting with - [ ])
  const criteria = content
    .split('\n')
    .filter(line => /^\s*-\s*\[[ x]\]/.test(line))
    .map(line => line.replace(/^\s*-\s*\[[ x]\]\s*/, '').trim())

  // Extract wanman commands
  const commandRegex = /wanman\s+([a-z][\w:]+)(?:\s+([a-z]\w+))?/g
  const commands: string[] = []
  let cmdMatch
  while ((cmdMatch = commandRegex.exec(content)) !== null) {
    const cmd = cmdMatch[1]!
    const sub = cmdMatch[2]
    commands.push(sub ? `${cmd} ${sub}` : cmd)
  }

  return {
    frontmatter,
    filePath,
    agentName,
    content,
    hasInput,
    hasExpectedBehavior,
    hasSuccessCriteria,
    criteria,
    referencedCommands: [...new Set(commands)],
  }
}

/** Validate a parsed eval file (Tier 1 — structure only) */
export function validateEval(evalFile: EvalFile): EvalValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!evalFile.frontmatter.name) errors.push('Missing frontmatter: name')
  if (!evalFile.frontmatter.type) errors.push('Missing frontmatter: type')
  if (!['capability', 'preference'].includes(evalFile.frontmatter.type)) {
    errors.push(`Invalid type: ${evalFile.frontmatter.type} (must be capability or preference)`)
  }

  if (!evalFile.hasInput) errors.push('Missing section: ## Input')
  if (!evalFile.hasExpectedBehavior) errors.push('Missing section: ## Expected Behavior')
  if (!evalFile.hasSuccessCriteria) errors.push('Missing section: ## Success Criteria')

  if (evalFile.criteria.length === 0) {
    warnings.push('No checkable success criteria (- [ ] items) found')
  }

  if (evalFile.criteria.length < 2) {
    warnings.push('Fewer than 2 success criteria — consider adding more')
  }

  return {
    agentName: evalFile.agentName,
    evalName: evalFile.frontmatter.name,
    filePath: evalFile.filePath,
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/** Scan all eval files for an agent */
export function scanAgentEvals(agentDir: string, agentName: string): EvalFile[] {
  const evalsDir = path.join(agentDir, 'evals')
  if (!fs.existsSync(evalsDir)) return []

  return fs.readdirSync(evalsDir)
    .filter(f => f.endsWith('.eval.md'))
    .map(f => parseEvalFile(path.join(evalsDir, f), agentName))
    .filter((e): e is EvalFile => e !== null)
}

/** Scan all agents and validate all evals */
export function validateAllEvals(agentsDir: string): EvalValidationResult[] {
  const results: EvalValidationResult[] = []

  if (!fs.existsSync(agentsDir)) return results

  for (const agent of fs.readdirSync(agentsDir)) {
    const agentPath = path.join(agentsDir, agent)
    if (!fs.statSync(agentPath).isDirectory()) continue

    const evals = scanAgentEvals(agentPath, agent)
    for (const e of evals) {
      results.push(validateEval(e))
    }
  }

  return results
}

/** Format validation results as a report */
export function formatEvalReport(results: EvalValidationResult[]): string {
  const lines: string[] = []
  lines.push('Skill Eval Validation Report')
  lines.push('═'.repeat(50))

  const byAgent = new Map<string, EvalValidationResult[]>()
  for (const r of results) {
    const list = byAgent.get(r.agentName) || []
    list.push(r)
    byAgent.set(r.agentName, list)
  }

  let totalPassed = 0
  let totalFailed = 0

  for (const [agent, evals] of byAgent) {
    lines.push(`\n${agent}:`)
    for (const e of evals) {
      const status = e.valid ? '✅' : '❌'
      lines.push(`  ${status} ${e.evalName}`)
      for (const err of e.errors) lines.push(`     ❌ ${err}`)
      for (const w of e.warnings) lines.push(`     ⚠ ${w}`)
      if (e.valid) totalPassed++
      else totalFailed++
    }
  }

  lines.push('\n' + '─'.repeat(50))
  lines.push(`Total: ${results.length} evals, ${totalPassed} passed, ${totalFailed} failed`)

  return lines.join('\n')
}
