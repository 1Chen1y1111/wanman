import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { LaunchRecord, TakeoverLaunchInputRecord } from '@wanman/core'
import { resolveGithubToken } from './commands/sandbox-git.js'
import { extractGitHubRepoSlug, getGitHubAppInstallationToken } from './github-app-auth.js'

export interface MaterializedProject {
  projectPath: string
  cleanup(): Promise<void>
}

async function removeCheckout(checkoutRoot: string): Promise<void> {
  await fs.rm(checkoutRoot, { recursive: true, force: true })
}

function clonePublicRepo(repoUrl: string, checkoutRoot: string, repoRef?: string | null): void {
  const cloneArgs = ['clone', '--depth', '1']
  if (repoRef) cloneArgs.push('--branch', repoRef)
  cloneArgs.push(repoUrl, checkoutRoot)
  execFileSync('git', cloneArgs, { stdio: 'inherit' })
}

function cloneGitHubRepoWithRunnerEnv(repoUrl: string, checkoutRoot: string, repoRef?: string | null): void {
  const repoSlug = extractGitHubRepoSlug(repoUrl)
  if (!repoSlug) {
    throw new Error('runner_env repo auth currently only supports GitHub repositories')
  }

  const githubToken = resolveGithubToken()
  if (!githubToken) {
    throw new Error('runner_env repo auth requested but the launch runner has no GitHub token configured')
  }

  const cloneArgs = ['repo', 'clone', repoSlug, checkoutRoot, '--', '--depth', '1']
  if (repoRef) cloneArgs.push('--branch', repoRef)

  execFileSync('gh', cloneArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      GH_TOKEN: githubToken,
      GITHUB_TOKEN: process.env['GITHUB_TOKEN'] ?? githubToken,
    },
  })
}

async function cloneGitHubRepoWithGitHubApp(
  repoUrl: string,
  checkoutRoot: string,
  installationId: number | null | undefined,
  repoRef?: string | null,
): Promise<void> {
  const repoSlug = extractGitHubRepoSlug(repoUrl)
  if (!repoSlug) {
    throw new Error('github_app repo auth currently only supports GitHub repositories')
  }
  if (!Number.isFinite(installationId ?? Number.NaN)) {
    throw new Error('github_app repo auth requested without a GitHub installation id')
  }

  const installationToken = await getGitHubAppInstallationToken(installationId!)
  const cloneUrl = `https://x-access-token:${installationToken}@github.com/${repoSlug}.git`
  clonePublicRepo(cloneUrl, checkoutRoot, repoRef)
}

export async function materializeTakeoverProject(
  launch: Pick<LaunchRecord, 'id'>,
  input: TakeoverLaunchInputRecord,
): Promise<MaterializedProject> {
  const checkoutRoot = await fs.mkdtemp(path.join(os.tmpdir(), `wanman-launch-${launch.id}-`))

  try {
    if (input.repo_auth === 'runner_env') {
      cloneGitHubRepoWithRunnerEnv(input.repo_url, checkoutRoot, input.repo_ref)
    } else if (input.repo_auth === 'github_app') {
      await cloneGitHubRepoWithGitHubApp(
        input.repo_url,
        checkoutRoot,
        input.github_installation_id ?? null,
        input.repo_ref,
      )
    } else {
      clonePublicRepo(input.repo_url, checkoutRoot, input.repo_ref)
    }
  } catch (error) {
    await removeCheckout(checkoutRoot)
    throw error
  }

  return {
    projectPath: checkoutRoot,
    cleanup: () => removeCheckout(checkoutRoot),
  }
}
