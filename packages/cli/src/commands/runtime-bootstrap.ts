/**
 * runtime-bootstrap — Auto-detect project dependencies and generate install scripts.
 *
 * Uses the ProjectProfile from takeover scanning to determine what
 * package managers and build steps are needed, then generates a shell
 * script to run inside the sandbox after repo clone.
 */

import type { Sandbox } from '@sandbank.dev/core'
import type { ProjectProfile } from '../takeover-project.js'

/**
 * Generate a bootstrap shell script from a ProjectProfile.
 *
 * Returns undefined if no install steps are needed.
 * The script is meant to run with cwd set to the repo root.
 */
export function generateBootstrapScript(profile: ProjectProfile): string | undefined {
  const steps: string[] = []

  // Package manager install
  if (profile.packageManagers.includes('pnpm')) {
    steps.push(
      'command -v pnpm >/dev/null || npm i -g pnpm',
      'pnpm install --frozen-lockfile 2>/dev/null || pnpm install',
    )
  } else if (profile.packageManagers.includes('yarn')) {
    steps.push(
      'corepack enable',
      'yarn install --frozen-lockfile 2>/dev/null || yarn install',
    )
  } else if (profile.packageManagers.includes('npm')) {
    steps.push('npm ci 2>/dev/null || npm install')
  }

  if (profile.languages.includes('python')) {
    if (profile.packageManagers.includes('pip')) {
      steps.push('pip install -r requirements.txt 2>/dev/null || true')
    } else {
      // uv is pre-installed in codebox
      steps.push('uv sync 2>/dev/null || pip install -r requirements.txt 2>/dev/null || true')
    }
  }

  if (profile.languages.includes('go')) {
    steps.push('go mod download 2>/dev/null || true')
  }

  if (profile.languages.includes('rust')) {
    steps.push('cargo fetch 2>/dev/null || true')
  }

  // Build step — only if project has an explicit build script
  if (profile.packageScripts?.includes('build')) {
    if (profile.packageManagers.includes('pnpm')) {
      steps.push('pnpm build')
    } else if (profile.packageManagers.includes('yarn')) {
      steps.push('yarn build')
    } else {
      steps.push('npm run build')
    }
  }

  if (steps.length === 0) return undefined
  return steps.join(' && ')
}

/**
 * Run the bootstrap script inside a sandbox.
 *
 * Logs progress and handles failures gracefully — a bootstrap failure
 * should not prevent agents from starting (they can still read/modify code).
 */
export async function runBootstrap(
  sandbox: Sandbox,
  script: string,
  cwd: string,
): Promise<{ success: boolean; output: string }> {
  console.log(`  [bootstrap] Installing dependencies in ${cwd}...`)
  console.log(`  [bootstrap] Script: ${script.slice(0, 200)}${script.length > 200 ? '...' : ''}`)

  const result = await sandbox.exec(script, {
    timeout: 300_000, // 5 min
    cwd,
  })

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n')

  if (result.exitCode !== 0) {
    console.log(`  [bootstrap] Warning: bootstrap exited with code ${result.exitCode}`)
    console.log(`  [bootstrap] Agents will start anyway (code is readable, tests may not run)`)
    return { success: false, output }
  }

  console.log('  [bootstrap] Dependencies installed successfully.')
  return { success: true, output }
}
