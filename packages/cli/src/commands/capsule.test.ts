import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../transport.js', () => ({
  rpcCall: vi.fn(),
}));

import { capsuleCommand } from './capsule.js';
import { rpcCall } from '../transport.js';

const mockRpcCall = vi.mocked(rpcCall);

describe('capsuleCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  it('passes capsule create parameters through RPC', async () => {
    mockRpcCall.mockResolvedValue({
      jsonrpc: '2.0',
      id: 1,
      result: { id: 'capsule-1', branch: 'wanman/fix-webhook', status: 'open', conflicts: [] },
    });

    await capsuleCommand([
      'create',
      '--goal', 'Fix webhook ingestion',
      '--owner', 'dev',
      '--branch', 'wanman/fix-webhook',
      '--base', 'abc123',
      '--paths', 'apps/api/src/routes/webhooks.ts,apps/api/src/routes/webhooks.test.ts',
      '--acceptance', 'webhook forwards payload and tests pass',
      '--initiative', 'initiative-1',
      '--task', 'task-1',
      '--subsystem', 'api-webhooks',
      '--scope-type', 'code',
    ]);

    expect(mockRpcCall).toHaveBeenCalledWith('capsule.create', expect.objectContaining({
      goal: 'Fix webhook ingestion',
      ownerAgent: 'dev',
      branch: 'wanman/fix-webhook',
      baseCommit: 'abc123',
      allowedPaths: [
        'apps/api/src/routes/webhooks.ts',
        'apps/api/src/routes/webhooks.test.ts',
      ],
      initiativeId: 'initiative-1',
      taskId: 'task-1',
      subsystem: 'api-webhooks',
      scopeType: 'code',
    }));
  });

  it('uses the current agent for capsule mine by default', async () => {
    mockRpcCall.mockResolvedValue({
      jsonrpc: '2.0',
      id: 1,
      result: {
        capsules: [
          { id: 'capsule-1', goal: 'Fix webhook ingestion', status: 'open', branch: 'wanman/fix-webhook', acceptance: 'tests pass' },
        ],
      },
    });

    await capsuleCommand(['mine']);

    expect(mockRpcCall).toHaveBeenCalledWith('capsule.mine', expect.objectContaining({
      agent: process.env['WANMAN_AGENT_NAME'] || 'cli',
      status: undefined,
    }));
  });
});
