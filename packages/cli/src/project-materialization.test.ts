import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mkdtemp: vi.fn(),
  rm: vi.fn(),
  execFileSync: vi.fn(),
  resolveGithubToken: vi.fn(),
  getGitHubAppInstallationToken: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  mkdtemp: mocks.mkdtemp,
  rm: mocks.rm,
}))

vi.mock('node:child_process', () => ({
  execFileSync: mocks.execFileSync,
}))

vi.mock('./commands/sandbox-git.js', () => ({
  resolveGithubToken: mocks.resolveGithubToken,
}))

vi.mock('./github-app-auth.js', async () => {
  const actual = await vi.importActual<typeof import('./github-app-auth.js')>('./github-app-auth.js')
  return {
    ...actual,
    getGitHubAppInstallationToken: mocks.getGitHubAppInstallationToken,
  }
})

import { materializeTakeoverProject } from './project-materialization.js'

describe('materializeTakeoverProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mkdtemp.mockResolvedValue('/tmp/wanman-launch-launch-1-checkout')
    mocks.rm.mockResolvedValue(undefined)
    mocks.resolveGithubToken.mockReturnValue(undefined)
    mocks.getGitHubAppInstallationToken.mockResolvedValue('app-token')
  })

  it('clones public repositories with git clone', async () => {
    const project = await materializeTakeoverProject(
      { id: 'launch-1' },
      {
        repo_url: 'https://github.com/acme/repo',
        repo_ref: 'main',
      },
    )

    expect(mocks.execFileSync).toHaveBeenCalledWith(
      'git',
      ['clone', '--depth', '1', '--branch', 'main', 'https://github.com/acme/repo', '/tmp/wanman-launch-launch-1-checkout'],
      { stdio: 'inherit' },
    )

    await project.cleanup()
    expect(mocks.rm).toHaveBeenCalledWith('/tmp/wanman-launch-launch-1-checkout', {
      recursive: true,
      force: true,
    })
  })

  it('uses runner GitHub auth when repo_auth is runner_env', async () => {
    mocks.resolveGithubToken.mockReturnValue('gh-token')

    await materializeTakeoverProject(
      { id: 'launch-1' },
      {
        repo_url: 'https://github.com/acme/private-repo',
        repo_ref: 'main',
        repo_auth: 'runner_env',
      },
    )

    expect(mocks.execFileSync).toHaveBeenCalledWith(
      'gh',
      ['repo', 'clone', 'acme/private-repo', '/tmp/wanman-launch-launch-1-checkout', '--', '--depth', '1', '--branch', 'main'],
      expect.objectContaining({
        stdio: 'inherit',
        env: expect.objectContaining({
          GH_TOKEN: 'gh-token',
          GITHUB_TOKEN: 'gh-token',
        }),
      }),
    )
  })

  it('fails fast when runner_env auth is requested but no GitHub token exists', async () => {
    await expect(materializeTakeoverProject(
      { id: 'launch-1' },
      {
        repo_url: 'git@github.com:acme/private-repo.git',
        repo_auth: 'runner_env',
      },
    )).rejects.toThrow('runner_env repo auth requested but the launch runner has no GitHub token configured')

    expect(mocks.rm).toHaveBeenCalledWith('/tmp/wanman-launch-launch-1-checkout', {
      recursive: true,
      force: true,
    })
  })

  it('uses GitHub App installation auth when repo_auth is github_app', async () => {
    await materializeTakeoverProject(
      { id: 'launch-1' },
      {
        repo_url: 'https://github.com/acme/private-repo',
        repo_ref: 'release',
        repo_auth: 'github_app',
        github_installation_id: 42,
      },
    )

    expect(mocks.getGitHubAppInstallationToken).toHaveBeenCalledWith(42)
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      'git',
      ['clone', '--depth', '1', '--branch', 'release', 'https://x-access-token:app-token@github.com/acme/private-repo.git', '/tmp/wanman-launch-launch-1-checkout'],
      { stdio: 'inherit' },
    )
  })
})
