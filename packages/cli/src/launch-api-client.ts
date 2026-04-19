import {
  createLaunchApiClient,
  createLaunchRuntimeClient,
  createLaunchSdk,
  type LaunchApiClient,
  type LaunchApiRequest,
  type LaunchRuntimeClient,
  type LaunchRuntimeStreamRequestRecord,
  type LaunchSdkClient,
} from '@wanman/core'
import {
  buildCliStoryApiUrl,
  createCliStoryApiHeaders,
  type CliStoryApiOptions,
} from './story-api-client.js'

export interface CliLaunchApiOptions extends CliStoryApiOptions {}

export function resolveCliLaunchApiOptions(env: NodeJS.ProcessEnv = process.env): CliLaunchApiOptions | null {
  const apiBaseUrl = env['WANMAN_API_URL']
  const token = env['WANMAN_API_TOKEN']
  if (!apiBaseUrl || !token) return null

  return {
    apiBaseUrl,
    token,
  }
}

async function requestLaunchApi<T>(options: CliLaunchApiOptions, request: LaunchApiRequest): Promise<T> {
  const response = await fetch(buildCliStoryApiUrl(options, request.path), {
    method: request.method,
    headers: {
      ...createCliStoryApiHeaders(options.token),
      'Content-Type': 'application/json',
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Launch API ${response.status}: ${text}`)
  }

  return await response.json() as T
}

export function createCliLaunchApiClient(options: CliLaunchApiOptions): LaunchApiClient {
  return createLaunchApiClient((request) => requestLaunchApi(options, request))
}

export async function openCliLaunchStream(
  options: CliLaunchApiOptions,
  request: LaunchRuntimeStreamRequestRecord,
) {
  return fetch(buildCliStoryApiUrl(options, request.path), {
    headers: createCliStoryApiHeaders(options.token, request.headers),
    signal: request.signal,
  })
}

export function createCliLaunchRuntimeClient(options: CliLaunchApiOptions): LaunchRuntimeClient {
  return createLaunchRuntimeClient({
    api: createCliLaunchApiClient(options),
    openStream: (request) => openCliLaunchStream(options, request),
  })
}

export function createCliLaunchSdk(options: CliLaunchApiOptions): LaunchSdkClient {
  return createLaunchSdk({
    transport: (request) => requestLaunchApi(options, request),
    openStream: (request) => openCliLaunchStream(options, request),
  })
}
