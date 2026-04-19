import { describe, expect, it } from 'vitest'
import {
  codexStatusIndicatesAuthenticated,
  detectRequiredRuntimes,
  parseCodexDeviceAuthOutput,
} from './sandbox-auth.js'

describe('sandbox-auth helpers', () => {
  it('detects runtimes from config text', () => {
    const runtimes = detectRequiredRuntimes(JSON.stringify({
      agents: [
        { name: 'ceo', lifecycle: '24/7', model: 'claude-sonnet-4-6', systemPrompt: 'ceo' },
        { name: 'dev', lifecycle: 'on-demand', runtime: 'codex', model: 'gpt-5.4', systemPrompt: 'dev' },
      ],
    }))

    expect(runtimes.sort()).toEqual(['claude', 'codex'])
  })

  it('lets env override collapse runtimes to one backend', () => {
    const runtimes = detectRequiredRuntimes(JSON.stringify({
      agents: [
        { name: 'ceo', lifecycle: '24/7', model: 'claude-sonnet-4-6', systemPrompt: 'ceo' },
        { name: 'dev', lifecycle: 'on-demand', runtime: 'codex', model: 'gpt-5.4', systemPrompt: 'dev' },
      ],
    }), 'codex')

    expect(runtimes).toEqual(['codex'])
  })

  it('parses Codex device-auth URL and code from screen output', () => {
    const parsed = parseCodexDeviceAuthOutput(`
      1. Open this link in your browser and sign in to your account
         https://auth.openai.com/codex/device
      2. Enter this one-time code (expires in 15 minutes)
         873C-DOW5N
    `)

    expect(parsed).toEqual({
      url: 'https://auth.openai.com/codex/device',
      code: '873C-DOW5N',
    })
  })

  it('recognizes authenticated codex login status', () => {
    expect(codexStatusIndicatesAuthenticated('Logged in using ChatGPT')).toBe(true)
    expect(codexStatusIndicatesAuthenticated('Not logged in')).toBe(false)
  })
})
