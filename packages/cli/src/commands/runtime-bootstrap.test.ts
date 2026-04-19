import { describe, it, expect } from 'vitest'
import { generateBootstrapScript } from './runtime-bootstrap.js'
import type { ProjectProfile } from './takeover.js'

function makeProfile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  return {
    path: '/tmp/test',
    languages: [],
    packageManagers: [],
    frameworks: [],
    ci: [],
    testFrameworks: [],
    hasReadme: false,
    hasClaudeMd: false,
    hasDocs: false,
    issueTracker: 'none',
    ...overrides,
  }
}

describe('generateBootstrapScript', () => {
  it('should return undefined for empty profile', () => {
    expect(generateBootstrapScript(makeProfile())).toBeUndefined()
  })

  it('should generate pnpm install for pnpm projects', () => {
    const script = generateBootstrapScript(makeProfile({
      packageManagers: ['pnpm'],
    }))
    expect(script).toContain('pnpm install')
  })

  it('should generate npm ci for npm projects', () => {
    const script = generateBootstrapScript(makeProfile({
      packageManagers: ['npm'],
    }))
    expect(script).toContain('npm ci')
  })

  it('should generate yarn install for yarn projects', () => {
    const script = generateBootstrapScript(makeProfile({
      packageManagers: ['yarn'],
    }))
    expect(script).toContain('yarn install')
    expect(script).toContain('corepack enable')
  })

  it('should generate pip install for python projects', () => {
    const script = generateBootstrapScript(makeProfile({
      languages: ['python'],
      packageManagers: ['pip'],
    }))
    expect(script).toContain('pip install')
  })

  it('should generate uv sync for python without pip', () => {
    const script = generateBootstrapScript(makeProfile({
      languages: ['python'],
    }))
    expect(script).toContain('uv sync')
  })

  it('should generate go mod download for go projects', () => {
    const script = generateBootstrapScript(makeProfile({
      languages: ['go'],
    }))
    expect(script).toContain('go mod download')
  })

  it('should generate cargo fetch for rust projects', () => {
    const script = generateBootstrapScript(makeProfile({
      languages: ['rust'],
    }))
    expect(script).toContain('cargo fetch')
  })

  it('should add build step when project has build script', () => {
    const script = generateBootstrapScript(makeProfile({
      packageManagers: ['pnpm'],
      packageScripts: ['dev', 'build', 'test'],
    }))
    expect(script).toContain('pnpm install')
    expect(script).toContain('pnpm build')
  })

  it('should not add build step when no build script', () => {
    const script = generateBootstrapScript(makeProfile({
      packageManagers: ['pnpm'],
      packageScripts: ['dev', 'test'],
    }))
    expect(script).toContain('pnpm install')
    expect(script).not.toContain('build')
  })

  it('should handle multi-language project', () => {
    const script = generateBootstrapScript(makeProfile({
      languages: ['typescript', 'javascript', 'python'],
      packageManagers: ['pnpm', 'pip'],
    }))
    expect(script).toContain('pnpm install')
    expect(script).toContain('pip install')
  })
})
