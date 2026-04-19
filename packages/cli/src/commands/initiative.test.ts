import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../transport.js', () => ({
  rpcCall: vi.fn(),
}));

import { initiativeCommand } from './initiative.js';
import { rpcCall } from '../transport.js';

const mockRpcCall = vi.mocked(rpcCall);

describe('initiativeCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  it('passes initiative create parameters through RPC', async () => {
    mockRpcCall.mockResolvedValue({
      jsonrpc: '2.0',
      id: 1,
      result: { id: 'initiative-1', title: 'Roadmap', status: 'active' },
    });

    await initiativeCommand([
      'create',
      'Advance roadmap',
      '--goal', 'Ship the next roadmap milestone',
      '--summary', 'Prioritize external value',
      '--priority', '9',
      '--source', 'README.md,docs/ROADMAP.md',
    ]);

    expect(mockRpcCall).toHaveBeenCalledWith('initiative.create', expect.objectContaining({
      title: 'Advance roadmap',
      goal: 'Ship the next roadmap milestone',
      summary: 'Prioritize external value',
      priority: 9,
      sources: ['README.md', 'docs/ROADMAP.md'],
    }));
  });

  it('lists initiatives', async () => {
    mockRpcCall.mockResolvedValue({
      jsonrpc: '2.0',
      id: 1,
      result: {
        initiatives: [
          { id: 'abc12345-1111-2222-3333-444444444444', title: 'Roadmap', status: 'active', priority: 9, summary: 'External delivery' },
        ],
      },
    });

    await initiativeCommand(['list', '--status', 'active']);

    expect(mockRpcCall).toHaveBeenCalledWith('initiative.list', { status: 'active' });
    expect(console.log).toHaveBeenCalledWith('[active] abc12345 P9 "Roadmap" — External delivery');
  });
});
