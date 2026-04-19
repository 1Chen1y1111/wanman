import {
  createLaunchRunnerApiClient,
  type LaunchRunnerApiClient,
  type LaunchRunnerApiRequest,
} from '@wanman/core'

export interface CliLaunchRunnerOptions {
  apiBaseUrl: string
  runnerSecret: string
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, '')
}

function buildRunnerUrl(options: CliLaunchRunnerOptions, path: string): string {
  return `${normalizeApiBaseUrl(options.apiBaseUrl)}${path}`
}

async function requestLaunchRunnerApi<T>(
  options: CliLaunchRunnerOptions,
  request: LaunchRunnerApiRequest,
): Promise<T> {
  const response = await fetch(buildRunnerUrl(options, request.path), {
    method: request.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-launch-runner-secret': options.runnerSecret,
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Launch runner API ${response.status}: ${text}`)
  }

  return await response.json() as T
}

export function createCliLaunchRunnerClient(options: CliLaunchRunnerOptions): LaunchRunnerApiClient {
  return createLaunchRunnerApiClient((request) => requestLaunchRunnerApi(options, request))
}
