import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { AgentMatrixConfig } from '../types.js';
import { PRODUCTION_AGENTS, TEST_AGENTS } from '../agents/registry.js';

function readConfig(relativePath: string): AgentMatrixConfig {
  const filename = fileURLToPath(new URL(relativePath, import.meta.url));
  return JSON.parse(readFileSync(filename, 'utf-8')) as AgentMatrixConfig;
}

describe('container config sync', () => {
  it('keeps apps/container/agents.json aligned with PRODUCTION_AGENTS', () => {
    const config = readConfig('../../../../apps/container/agents.json');
    expect(config.agents).toEqual(PRODUCTION_AGENTS);
    expect(config.relay).toBeUndefined();
    expect(config.dbPath).toBe('/data/wanman.db');
  });

  it('keeps apps/container/agents.local.json aligned with PRODUCTION_AGENTS', () => {
    const config = readConfig('../../../../apps/container/agents.local.json');
    expect(config.agents).toEqual(PRODUCTION_AGENTS);
    expect(config.relay).toBeUndefined();
    expect(config.dbPath).toBe('/workspace/wanman.db');
  });

  it('keeps apps/container/agents.test.json aligned with TEST_AGENTS', () => {
    const config = readConfig('../../../../apps/container/agents.test.json');
    expect(config.agents).toEqual(TEST_AGENTS);
    expect(config.dbPath).toBe('/tmp/wanman-test.db');
  });
});
