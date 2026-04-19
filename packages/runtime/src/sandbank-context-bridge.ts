/**
 * SandbankContextBridge — implements the same interface as the local ContextStore
 * but uses the Sandbank relay's context.get / context.set / context.keys RPCs
 * via HTTP POST /rpc.
 *
 * Note: Sandbank ContextStore does not track `updatedBy`/`updatedAt`.
 * We return best-effort values (agent name from set calls, Date.now() timestamps).
 */

import type { ContextEntry } from '@wanman/core';
import { createLogger } from './logger.js';

const log = createLogger('sandbank-context-bridge');

export interface SandbankContextBridgeOptions {
  /** HTTP URL of the relay, e.g. http://127.0.0.1:9000 */
  relayUrl: string;
  /** Session ID (must match the relay bridge's session) */
  sessionId: string;
  /** Auth token (must match the relay bridge's token) */
  token: string;
}

export class SandbankContextBridge {
  private readonly relayUrl: string;
  private readonly sessionId: string;
  private readonly token: string;

  constructor(options: SandbankContextBridgeOptions) {
    this.relayUrl = options.relayUrl;
    this.sessionId = options.sessionId;
    this.token = options.token;
  }

  /** Get a context entry by key. Returns null if not found. */
  async get(key: string): Promise<ContextEntry | null> {
    const result = await this.httpRpc('context.get', { key }) as { value: unknown } | null;

    if (!result || result.value === null || result.value === undefined) {
      return null;
    }

    return {
      key,
      value: typeof result.value === 'string' ? result.value : JSON.stringify(result.value),
      updatedBy: 'unknown',
      updatedAt: Date.now(),
    };
  }

  /** Set a context entry. */
  async set(key: string, value: string, agent: string): Promise<void> {
    await this.httpRpc('context.set', { key, value }, agent);
    log.info('set', { key, agent });
  }

  /** Get all context entries. */
  async getAll(): Promise<ContextEntry[]> {
    // First get all keys, then get each value
    const keysResult = await this.httpRpc('context.keys', {}) as { keys: string[] } | null;
    if (!keysResult || !keysResult.keys || keysResult.keys.length === 0) {
      return [];
    }

    const entries: ContextEntry[] = [];
    for (const key of keysResult.keys) {
      const entry = await this.get(key);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  // --- Internal ---

  private async httpRpc(
    method: string,
    params: Record<string, unknown>,
    sandboxName?: string,
  ): Promise<unknown> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Session-Id': this.sessionId,
      'X-Auth-Token': this.token,
    };

    if (sandboxName) {
      headers['X-Sandbox-Name'] = sandboxName;
    }

    const response = await fetch(`${this.relayUrl}/rpc`, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      log.error('context HTTP error', { method, status: response.status, body: text });
      throw new Error(`Context bridge HTTP error: ${response.status}`);
    }

    const json = await response.json() as {
      result?: unknown;
      error?: { code: number; message: string };
    };

    if (json.error) {
      log.error('context RPC error', { method, error: json.error.message });
      throw new Error(`Context bridge RPC error: ${json.error.message}`);
    }

    return json.result;
  }
}
