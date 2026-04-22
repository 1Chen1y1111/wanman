/**
 * sandbox-git — GitHub credential setup and repo clone inside sandboxes.
 *
 * Uses `gh` CLI (pre-installed in codebox) for auth and clone.
 * No SSH keys needed — HTTPS + token via git credential helper.
 */

import { execSync } from 'node:child_process'
import type { Sandbox } from '@sandbank.dev/core'

/**
 * Resolve a GitHub token from the environment or gh CLI.
 *
 * Priority:
 *   1. Explicit `--github-token` flag (passed through)
 *   2. `GITHUB_TOKEN` env var
 *   3. `gh auth token` output (reads from gh CLI config)
 */
export function resolveGithubToken(explicit?: string): string | undefined {
  if (explicit) return explicit

  const envToken = process.env['GITHUB_TOKEN'] || process.env['GH_TOKEN']
  if (envToken) return envToken

  try {
    const token = execSync('gh auth token 2>/dev/null', { encoding: 'utf-8' }).trim()
    if (token) return token
  } catch { /* gh not installed or not logged in */ }

  return undefined
}

/**
 * Configure git + gh auth inside a sandbox using a GitHub token.
 *
 * Sets up:
 *   - `gh auth setup-git` (configures git credential helper)
 *   - git user identity (wanman-agent)
 */
export async function setupGitInSandbox(sandbox: Sandbox, token: string): Promise<void> {
  console.log('  [git] Setting up GitHub auth in sandbox...')

  // Write token to a file so gh can read it non-interactively
  await sandbox.exec(`echo '${token}' | gh auth login --with-token`)
  await sandbox.exec('gh auth setup-git')

  // Set git identity for commits
  await sandbox.exec('git config --global user.name "wanman-agent"')
  await sandbox.exec('git config --global user.email "agent@wanman.dev"')

  // Sensible defaults
  await sandbox.exec('git config --global push.autoSetupRemote true')
  await sandbox.exec('git config --global init.defaultBranch main')
}

export interface CloneOptions {
  /** Shallow clone (--depth 1) for faster startup on large repos */
  shallow?: boolean
  /** Specific branch to clone */
  branch?: string
}

/**
 * Clone a GitHub repo into the sandbox via `gh repo clone`.
 *
 * Falls back to `git clone` with HTTPS for non-GitHub remotes.
 */
export async function cloneRepo(
  sandbox: Sandbox,
  cloneUrl: string,
  targetDir: string,
  opts: CloneOptions = {},
): Promise<void> {
  console.log(`  [git] Cloning ${cloneUrl} → ${targetDir}...`)

  // Ensure parent directory exists, but NOT the target itself (git clone expects it to not exist or be empty)
  const parentDir = targetDir.replace(/\/[^/]+\/?$/, '')
  if (parentDir && parentDir !== targetDir) {
    await sandbox.exec(`mkdir -p '${parentDir}'`)
  }
  // Remove target if it exists but is empty (e.g. created by a prior mkdir -p)
  await sandbox.exec(`rmdir '${targetDir}' 2>/dev/null || true`)

  const depthFlag = opts.shallow ? '--depth 1' : ''
  const branchFlag = opts.branch ? `--branch '${opts.branch}'` : ''

  // Detect GitHub short form (owner/repo) vs full URL
  const isGitHubShort = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(cloneUrl)
  const isGitHubUrl = cloneUrl.includes('github.com')

  if (isGitHubShort || isGitHubUrl) {
    // Use gh repo clone (handles auth automatically)
    const repo = isGitHubShort
      ? cloneUrl
      : cloneUrl.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '')

    const result = await sandbox.exec(
      `gh repo clone '${repo}' '${targetDir}' -- ${depthFlag} ${branchFlag}`.trim(),
      { timeout: 300_000 },
    )
    if (result.exitCode !== 0) {
      throw new Error(`gh repo clone failed (exit ${result.exitCode}): ${result.stderr}`)
    }
  } else {
    // Non-GitHub remote: plain git clone
    const result = await sandbox.exec(
      `git clone ${depthFlag} ${branchFlag} '${cloneUrl}' '${targetDir}'`.trim(),
      { timeout: 300_000 },
    )
    if (result.exitCode !== 0) {
      throw new Error(`git clone failed (exit ${result.exitCode}): ${result.stderr}`)
    }
  }

  console.log(`  [git] Clone complete.`)
}
