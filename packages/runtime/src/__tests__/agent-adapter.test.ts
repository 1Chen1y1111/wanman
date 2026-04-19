import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDefinition } from '@wanman/core';
import {
  createAgentAdapter,
  normalizeAgentRuntime,
  resolveAgentRuntime,
} from '../agent-adapter.js';

function makeDefinition(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name: 'ceo',
    lifecycle: '24/7',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Lead the team.',
    ...overrides,
  };
}

afterEach(() => {
  delete process.env['WANMAN_RUNTIME'];
});

describe('agent-adapter', () => {
  it('defaults to claude runtime', () => {
    expect(resolveAgentRuntime(makeDefinition())).toBe('claude');
  });

  it('uses explicit agent runtime when env override is absent', () => {
    expect(resolveAgentRuntime(makeDefinition({ runtime: 'codex' }))).toBe('codex');
  });

  it('lets WANMAN_RUNTIME override agent config', () => {
    process.env['WANMAN_RUNTIME'] = 'codex';
    expect(resolveAgentRuntime(makeDefinition({ runtime: 'claude' }))).toBe('codex');
  });

  it('normalizes unknown runtimes back to claude', () => {
    expect(normalizeAgentRuntime('gemini')).toBe('claude');
  });

  it('creates a codex adapter', () => {
    expect(createAgentAdapter('codex').runtime).toBe('codex');
  });

  it('creates a claude adapter', () => {
    expect(createAgentAdapter('claude').runtime).toBe('claude');
  });
});
