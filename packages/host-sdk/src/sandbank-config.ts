export interface SandbankCloudConfig {
  apiUrl: string
  apiKey?: string
  image?: string
  cloneFrom?: string
}

export function resolveSandbankCloudConfig(env: NodeJS.ProcessEnv): SandbankCloudConfig | null {
  const apiUrl = env['SANDBANK_URL'] || env['SANDBANK_CLOUD_URL']
  if (!apiUrl) return null

  return {
    apiUrl,
    apiKey: env['SANDBANK_API_KEY'] || env['SANDBANK_CLOUD_API_KEY'] || '',
    image: env['SANDBANK_CLOUD_IMAGE'],
    cloneFrom: env['SANDBANK_CLONE_FROM'],
  }
}

export function applySandbankCloudConfig(
  env: NodeJS.ProcessEnv,
  config?: SandbankCloudConfig,
): NodeJS.ProcessEnv {
  if (!config) return { ...env }

  const nextEnv = { ...env }
  nextEnv['SANDBANK_URL'] = config.apiUrl

  if (config.apiKey !== undefined) nextEnv['SANDBANK_API_KEY'] = config.apiKey
  if (config.image !== undefined) nextEnv['SANDBANK_CLOUD_IMAGE'] = config.image
  if (config.cloneFrom !== undefined) nextEnv['SANDBANK_CLONE_FROM'] = config.cloneFrom

  return nextEnv
}
