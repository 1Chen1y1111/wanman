import { describe, expect, it, vi } from 'vitest';
import type { GitHubApiTransport } from './github-api.js';
import {
  buildGitHubConnectPath,
  buildGitHubInstallationReposPath,
  buildGitHubInstallationsPath,
  buildGitHubPath,
  createGitHubApiClient,
} from './github-api.js';

describe('github-api paths', () => {
  it('builds GitHub integration paths', () => {
    expect(buildGitHubPath()).toBe('/api/github');
    expect(buildGitHubConnectPath()).toBe('/api/github/connect');
    expect(buildGitHubInstallationsPath()).toBe('/api/github/installations');
    expect(buildGitHubInstallationReposPath(42)).toBe('/api/github/installations/42/repos');
  });
});

describe('createGitHubApiClient', () => {
  it('loads connection status', async () => {
    const transport = vi.fn(async () => ({
      github: { connected: true, github_login: 'acme', github_avatar_url: null, install_url: 'https://github.com/apps/wanman' },
    })) as GitHubApiTransport;
    const client = createGitHubApiClient(transport);

    await expect(client.getStatus()).resolves.toEqual({
      connected: true,
      github_login: 'acme',
      github_avatar_url: null,
      install_url: 'https://github.com/apps/wanman',
    });
    expect(transport).toHaveBeenCalledWith({ path: '/api/github' });
  });

  it('creates a connect request', async () => {
    const transport = vi.fn(async () => ({
      authorize_url: 'https://github.com/login/oauth/authorize?state=abc',
    })) as GitHubApiTransport;
    const client = createGitHubApiClient(transport);

    await expect(client.createConnectRequest({ redirect_to: 'https://app.wanman.ai/launches' })).resolves.toEqual({
      authorize_url: 'https://github.com/login/oauth/authorize?state=abc',
    });
    expect(transport).toHaveBeenCalledWith({
      path: '/api/github/connect',
      method: 'POST',
      body: { redirect_to: 'https://app.wanman.ai/launches' },
    });
  });

  it('lists installations and repos', async () => {
    const transport = vi.fn(async (request) => {
      if (request.path.endsWith('/repos')) {
        return {
          repos: [{ id: 2, full_name: 'acme/repo' }],
        };
      }
      return {
        installations: [{ id: 1, account_login: 'acme', account_type: 'Organization', account_avatar_url: 'https://avatar', repository_selection: 'selected' }],
      };
    }) as GitHubApiTransport;
    const client = createGitHubApiClient(transport);

    await expect(client.listInstallations()).resolves.toEqual([
      { id: 1, account_login: 'acme', account_type: 'Organization', account_avatar_url: 'https://avatar', repository_selection: 'selected' },
    ]);
    await expect(client.listInstallationRepos(1)).resolves.toEqual([{ id: 2, full_name: 'acme/repo' }]);
  });
});
