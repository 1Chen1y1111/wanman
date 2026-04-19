import type {
  GitHubConnectionStatusRecord,
  GitHubInstallationRecord,
  GitHubRepoRecord,
} from './types.js';

export interface GitHubConnectRequestRecord {
  redirect_to: string;
}

export interface GitHubConnectResponseRecord {
  authorize_url: string;
}

export interface GitHubStatusResponseRecord {
  github: GitHubConnectionStatusRecord;
}

export interface GitHubInstallationsResponseRecord {
  installations: GitHubInstallationRecord[];
}

export interface GitHubInstallationReposResponseRecord {
  repos: GitHubRepoRecord[];
}

export interface GitHubApiRequest {
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
}

export type GitHubApiTransport = <TResponse>(request: GitHubApiRequest) => Promise<TResponse>;

export interface GitHubApiClient {
  getStatus(): Promise<GitHubConnectionStatusRecord>;
  createConnectRequest(input: GitHubConnectRequestRecord): Promise<GitHubConnectResponseRecord>;
  listInstallations(): Promise<GitHubInstallationRecord[]>;
  listInstallationRepos(installationId: number): Promise<GitHubRepoRecord[]>;
}

export function buildGitHubPath(): string {
  return '/api/github';
}

export function buildGitHubConnectPath(): string {
  return `${buildGitHubPath()}/connect`;
}

export function buildGitHubInstallationsPath(): string {
  return `${buildGitHubPath()}/installations`;
}

export function buildGitHubInstallationReposPath(installationId: number): string {
  return `${buildGitHubInstallationsPath()}/${encodeURIComponent(String(installationId))}/repos`;
}

export function createGitHubApiClient(transport: GitHubApiTransport): GitHubApiClient {
  return {
    async getStatus() {
      const response = await transport<GitHubStatusResponseRecord>({
        path: buildGitHubPath(),
      });
      return response.github;
    },
    createConnectRequest(input) {
      return transport<GitHubConnectResponseRecord>({
        path: buildGitHubConnectPath(),
        method: 'POST',
        body: input,
      });
    },
    async listInstallations() {
      const response = await transport<GitHubInstallationsResponseRecord>({
        path: buildGitHubInstallationsPath(),
      });
      return response.installations;
    },
    async listInstallationRepos(installationId) {
      const response = await transport<GitHubInstallationReposResponseRecord>({
        path: buildGitHubInstallationReposPath(installationId),
      });
      return response.repos;
    },
  };
}
