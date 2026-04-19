import {
  createStoryApiClient,
  createStoryRuntimeClient,
  createStorySdk,
  type StoryApiClient,
  type StoryApiRequest,
  type StoryRuntimeClient,
  type StoryRuntimeStreamRequestRecord,
  type StorySdkClient,
} from '@wanman/core'

export interface CliStoryApiOptions {
  apiBaseUrl: string
  token: string
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, '')
}

export function buildCliStoryApiUrl(options: Pick<CliStoryApiOptions, 'apiBaseUrl'>, path: string): string {
  return `${normalizeApiBaseUrl(options.apiBaseUrl)}${path}`
}

export function createCliStoryApiHeaders(token: string, extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }

  if (extraHeaders) Object.assign(headers, extraHeaders)

  return headers
}

async function requestStoryApi<T>(options: CliStoryApiOptions, request: StoryApiRequest): Promise<T> {
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
    throw new Error(`Story API ${response.status}: ${text}`)
  }

  return await response.json() as T
}

export function createCliStoryApiClient(options: CliStoryApiOptions): StoryApiClient {
  return createStoryApiClient((request) => requestStoryApi(options, request))
}

export async function openCliStoryStream(
  options: CliStoryApiOptions,
  request: StoryRuntimeStreamRequestRecord,
) {
  return fetch(buildCliStoryApiUrl(options, request.path), {
    headers: createCliStoryApiHeaders(options.token, request.headers),
    signal: request.signal,
  })
}

export function createCliStoryRuntimeClient(options: CliStoryApiOptions): StoryRuntimeClient {
  return createStoryRuntimeClient({
    api: createCliStoryApiClient(options),
    openStream: (request) => openCliStoryStream(options, request),
  })
}

export function createCliStorySdk(options: CliStoryApiOptions): StorySdkClient {
  return createStorySdk({
    transport: (request) => requestStoryApi(options, request),
    openStream: (request) => openCliStoryStream(options, request),
  })
}
