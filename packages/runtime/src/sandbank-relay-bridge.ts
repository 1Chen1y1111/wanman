/**
 * SandbankRelayBridge — connects to an already-running Sandbank relay
 * and implements the same API as the local Relay class.
 *
 * Does NOT start a relay server. That's the Supervisor's job (Task 6).
 * Communicates via WebSocket for send operations and HTTP POST /rpc for recv.
 */

import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { AgentMessage, MessagePriority } from '@wanman/core';
import { createLogger } from './logger.js';
import type { NewMessageCallback, SteerCallback } from './runtime-contracts.js';

const log = createLogger('sandbank-relay-bridge');

export interface SandbankRelayBridgeOptions {
  /** HTTP URL of the relay, e.g. http://127.0.0.1:9000 */
  relayUrl: string;
  /** WebSocket URL of the relay, e.g. ws://127.0.0.1:9000 */
  wsUrl: string;
  /** Agent names to register as sandboxes */
  agents: string[];
  /** Session ID (auto-generated if omitted) */
  sessionId?: string;
  /** Auth token (auto-generated if omitted) */
  token?: string;
}

interface PendingRpc {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SandbankRelayBridge {
  private ws: WebSocket | null = null;
  private onSteer: SteerCallback | null = null;
  private onNewMessage: NewMessageCallback | null = null;
  private pendingCounts = new Map<string, number>();
  private pendingSteerCounts = new Map<string, number>();
  private rpcId = 0;
  private pending = new Map<number, PendingRpc>();
  private readonly RPC_TIMEOUT_MS = 10_000;

  readonly relayUrl: string;
  readonly wsUrl: string;
  readonly agents: string[];
  readonly sessionId: string;
  readonly token: string;

  constructor(options: SandbankRelayBridgeOptions) {
    this.relayUrl = options.relayUrl;
    this.wsUrl = options.wsUrl;
    this.agents = options.agents;
    this.sessionId = options.sessionId ?? randomUUID();
    this.token = options.token ?? randomUUID();
  }

  /** Connect WebSocket, authenticate, and register all agents. */
  async initialize(): Promise<void> {
    this.ws = await this.connectWs();
    log.info('ws connected', { wsUrl: this.wsUrl });

    // Authenticate as orchestrator
    const authResult = await this.rpcCall('session.auth', {
      sessionId: this.sessionId,
      token: this.token,
      role: 'orchestrator',
    }) as { ok: boolean; token: string };
    log.info('authenticated', { sessionId: this.sessionId });

    // Register all agent names as sandboxes
    for (const agent of this.agents) {
      await this.rpcCall('session.register', {
        name: agent,
        sandboxId: `wanman-${agent}`,
      });
      log.info('registered agent', { agent });
    }
  }

  /** Close the WebSocket connection. */
  async close(): Promise<void> {
    // Clear all pending RPCs
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Bridge closing'));
      this.pending.delete(id);
    }

    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      if (ws.readyState === WebSocket.CLOSED) return;
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 1000);
        ws.once('close', () => { clearTimeout(timer); resolve(); });
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'bridge closing');
        } else {
          clearTimeout(timer);
          resolve();
        }
      });
    }
  }

  /** Register a callback for when a steer message arrives. */
  setSteerCallback(cb: SteerCallback): void {
    this.onSteer = cb;
  }

  /** Register a callback for when any message arrives (used to wake on-demand agents). */
  setNewMessageCallback(cb: NewMessageCallback): void {
    this.onNewMessage = cb;
  }

  /**
   * Send a message via the relay.
   * If priority is 'steer', triggers the steer callback synchronously first,
   * then sends to relay asynchronously.
   * Returns a locally-generated message ID (the relay doesn't return one).
   *
   * Uses HTTP RPC with X-Sandbox-Name set to the `from` agent so that
   * the relay correctly attributes the sender (the WS connection is
   * authenticated as orchestrator, which would override the from field).
   */
  send(from: string, to: string, type: string, payload: unknown, priority: MessagePriority): string {
    const id = randomUUID();
    this.bumpPending(to, 1, priority);

    // Fire steer callback synchronously so Supervisor can kill the agent process
    if (priority === 'steer' && this.onSteer) {
      log.info('triggering steer callback', { agent: to });
      this.onSteer(to);
    } else if (this.onNewMessage) {
      this.onNewMessage(to, priority);
    }

    // Send to relay via HTTP with the sender's sandbox name.
    // Fire-and-forget: if relay is down, the message is lost (no local WAL).
    // TODO: Add SQLite write-ahead log for durability parity with local Relay mode.
    this.httpSend(from, to, type, payload, priority).catch((err) => {
      this.bumpPending(to, -1, priority);
      log.error('message may be lost — relay send failed', { id, from, to, error: (err as Error).message });
    });

    log.info('send', { id, from, to, type, priority });
    return id;
  }

  /** Send a message via HTTP RPC, setting X-Sandbox-Name to the sender. */
  private async httpSend(
    from: string,
    to: string,
    type: string,
    payload: unknown,
    priority: MessagePriority,
  ): Promise<void> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'message.send',
      params: { to, type, payload, priority },
    });

    const response = await fetch(`${this.relayUrl}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': this.sessionId,
        'X-Sandbox-Name': from,
        'X-Auth-Token': this.token,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const json = await response.json() as { error?: { message: string } };
    if (json.error) {
      throw new Error(`RPC error: ${json.error.message}`);
    }
  }

  /**
   * Receive pending messages for an agent from the relay.
   * Uses HTTP endpoint to drain the target agent's queue.
   * Returns Promise<AgentMessage[]> (async, unlike the local Relay).
   */
  async recv(agent: string, limit = 10): Promise<AgentMessage[]> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'message.recv',
      params: { limit, wait: 0 },
    });

    const response = await fetch(`${this.relayUrl}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': this.sessionId,
        'X-Sandbox-Name': agent,
        'X-Auth-Token': this.token,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      log.error('recv HTTP error', { agent, status: response.status, body: text });
      return [];
    }

    const json = await response.json() as {
      result?: { messages: Array<{
        from: string;
        to: string | null;
        type: string;
        payload: unknown;
        priority: 'normal' | 'steer';
        timestamp: string;
      }> };
      error?: { code: number; message: string };
    };

    if (json.error) {
      log.error('recv RPC error', { agent, error: json.error.message });
      return [];
    }

    const messages = json.result?.messages ?? [];
    if (messages.length > 0) {
      let steerCount = 0;
      for (const message of messages) {
        if (message.priority === 'steer') steerCount++;
      }
      this.bumpPending(agent, -messages.length);
      if (steerCount > 0) {
        this.bumpPending(agent, 0, 'steer', -steerCount);
      }
      log.info('recv', { agent, count: messages.length });
    }

    // Map Sandbank QueuedMessage format to wanman AgentMessage format
    return messages.map((m) => ({
      id: randomUUID(),
      from: m.from,
      to: m.to ?? agent,
      type: m.type,
      payload: m.payload,
      priority: m.priority,
      timestamp: new Date(m.timestamp).getTime(),
      delivered: true,
    }));
  }

  /**
   * Check if an agent has pending steer messages.
   *
   */
  hasSteer(agent: string): boolean {
    return (this.pendingSteerCounts.get(agent) ?? 0) > 0;
  }

  /** Count locally-tracked pending messages for an agent. */
  countPending(agent: string): number {
    return this.pendingCounts.get(agent) ?? 0;
  }

  // --- Internal methods ---

  private connectWs(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      ws.once('open', () => {
        ws.removeListener('error', reject);
        this.setupWsListeners(ws);
        resolve(ws);
      });
      ws.once('error', (err) => {
        reject(new Error(`WebSocket connection failed: ${err.message}`));
      });
    });
  }

  private setupWsListeners(ws: WebSocket): void {
    ws.on('message', (data) => {
      let msg: { jsonrpc: string; id?: number; result?: unknown; error?: { code: number; message: string }; method?: string; params?: unknown };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        log.warn('failed to parse WS message');
        return;
      }

      // Response to a pending RPC call
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);

        if (msg.error) {
          entry.reject(new Error(`RPC error [${msg.error.code}]: ${msg.error.message}`));
        } else {
          entry.resolve(msg.result);
        }
        return;
      }

      // Server-initiated notification (message push, context.changed, etc.)
      if (msg.method) {
        log.debug('ws notification', { method: msg.method });
        // We don't use push notifications — we poll via HTTP recv.
        // But log for debugging.
      }
    });

    ws.on('close', (code, reason) => {
      log.warn('ws closed', { code, reason: reason.toString() });
    });

    ws.on('error', (err) => {
      log.error('ws error', { error: err.message });
    });
  }

  /** Send a JSON-RPC call over the WebSocket and wait for the response. */
  private rpcCall(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = ++this.rpcId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method} (${this.RPC_TIMEOUT_MS}ms)`));
      }, this.RPC_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      const request = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });

      this.ws.send(request, (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new Error(`WebSocket send failed: ${err.message}`));
        }
      });
    });
  }

  private bumpPending(
    agent: string,
    delta: number,
    priority?: MessagePriority,
    steerDelta = 0,
  ): void {
    const nextTotal = Math.max(0, (this.pendingCounts.get(agent) ?? 0) + delta);
    this.pendingCounts.set(agent, nextTotal);

    const derivedSteerDelta = steerDelta + (priority === 'steer' ? delta : 0);
    if (derivedSteerDelta !== 0) {
      const nextSteer = Math.max(0, (this.pendingSteerCounts.get(agent) ?? 0) + derivedSteerDelta);
      this.pendingSteerCounts.set(agent, nextSteer);
    }
  }
}
