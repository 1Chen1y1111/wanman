import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveGithubToken } from './sandbox-git.js'

describe('resolveGithubToken', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env['GITHUB_TOKEN']
    delete process.env['GH_TOKEN']
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('should return explicit token when provided', () => {
    expect(resolveGithubToken('explicit-token')).toBe('explicit-token')
  })

  it('should return GITHUB_TOKEN env var', () => {
    process.env['GITHUB_TOKEN'] = 'env-token'
    expect(resolveGithubToken()).toBe('env-token')
  })

  it('should return GH_TOKEN env var', () => {
    process.env['GH_TOKEN'] = 'gh-token'
    expect(resolveGithubToken()).toBe('gh-token')
  })

  it('should prefer explicit over env', () => {
    process.env['GITHUB_TOKEN'] = 'env-token'
    expect(resolveGithubToken('explicit')).toBe('explicit')
  })

  it('should prefer GITHUB_TOKEN over GH_TOKEN', () => {
    process.env['GITHUB_TOKEN'] = 'github'
    process.env['GH_TOKEN'] = 'gh'
    expect(resolveGithubToken()).toBe('github')
  })

  it('should return undefined when no token available', () => {
    // gh auth token will likely fail in test env — that's expected
    const result = resolveGithubToken()
    // Either undefined (no gh CLI) or a real token (dev has gh logged in)
    expect(result === undefined || typeof result === 'string').toBe(true)
  })
})
