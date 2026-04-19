import { describe, expect, it } from 'vitest'
import { applySandbankCloudConfig, resolveSandbankCloudConfig } from './sandbank-config.js'

describe('resolveSandbankCloudConfig', () => {
  it('reads modern Sandbank env names', () => {
    expect(resolveSandbankCloudConfig({
      SANDBANK_URL: 'https://sandbox.example.com',
      SANDBANK_API_KEY: 'sb-key',
      SANDBANK_CLOUD_IMAGE: 'codebox-pro',
      SANDBANK_CLONE_FROM: 'box-1',
    })).toEqual({
      apiUrl: 'https://sandbox.example.com',
      apiKey: 'sb-key',
      image: 'codebox-pro',
      cloneFrom: 'box-1',
    })
  })

  it('supports legacy cloud env names', () => {
    expect(resolveSandbankCloudConfig({
      SANDBANK_CLOUD_URL: 'https://sandbox.example.com',
      SANDBANK_CLOUD_API_KEY: 'sb-key',
    })).toEqual({
      apiUrl: 'https://sandbox.example.com',
      apiKey: 'sb-key',
      image: undefined,
      cloneFrom: undefined,
    })
  })

  it('returns null when no Sandbank URL is configured', () => {
    expect(resolveSandbankCloudConfig({})).toBeNull()
  })
})

describe('applySandbankCloudConfig', () => {
  it('overlays Sandbank settings onto a base env', () => {
    expect(applySandbankCloudConfig(
      { PATH: '/usr/bin', SANDBANK_URL: 'https://old.example.com' },
      {
        apiUrl: 'https://sandbox.example.com',
        apiKey: 'sb-key',
        image: 'codebox-pro',
        cloneFrom: 'box-1',
      },
    )).toEqual({
      PATH: '/usr/bin',
      SANDBANK_URL: 'https://sandbox.example.com',
      SANDBANK_API_KEY: 'sb-key',
      SANDBANK_CLOUD_IMAGE: 'codebox-pro',
      SANDBANK_CLONE_FROM: 'box-1',
    })
  })

  it('returns a copy when no Sandbank config is provided', () => {
    const baseEnv = { PATH: '/usr/bin' }
    const nextEnv = applySandbankCloudConfig(baseEnv)
    expect(nextEnv).toEqual(baseEnv)
    expect(nextEnv).not.toBe(baseEnv)
  })
})
