import type { Sandbox } from '@sandbank.dev/core';
import type { AgentMatrixConfig, AgentRuntime } from '@wanman/core';

const DEFAULT_SCREEN_OUTPUT = '/tmp/wanman-codex-screen-output';
const DEFAULT_SESSION = 'codex-login';

export interface CodexDeviceLogin {
  url: string;
  code: string;
  waitForCredentials(timeoutMs?: number): Promise<string>;
  cleanup(): Promise<void>;
}

export function normalizeRuntime(value?: string | null): AgentRuntime {
  return value === 'codex' ? 'codex' : 'claude';
}

export function detectRequiredRuntimes(
  configText: string,
  envRuntime?: string | null,
): AgentRuntime[] {
  if (envRuntime) {
    return [normalizeRuntime(envRuntime)];
  }

  try {
    const config = JSON.parse(configText) as Partial<AgentMatrixConfig>;
    const runtimes = new Set<AgentRuntime>();
    for (const agent of config.agents ?? []) {
      runtimes.add(normalizeRuntime(agent.runtime));
    }
    return runtimes.size > 0 ? Array.from(runtimes) : ['claude'];
  } catch {
    return ['claude'];
  }
}

export function parseCodexDeviceAuthOutput(text: string): { url: string | null; code: string | null } {
  const compact = text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ');

  const url = compact.match(/https:\/\/auth\.openai\.com\/[^\s]+/)?.[0] ?? null;
  const code = compact.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/)?.[0] ?? null;
  return { url, code };
}

export function codexStatusIndicatesAuthenticated(statusText: string): boolean {
  return /logged in/i.test(statusText) && !/not logged in/i.test(statusText);
}

async function ensureScreenInstalled(sandbox: Sandbox, installCommand: string): Promise<void> {
  const check = await sandbox.exec('which screen 2>/dev/null');
  if (check.exitCode === 0) return;

  const install = await sandbox.exec(installCommand, { timeout: 60_000 });
  if (install.exitCode !== 0) {
    throw new Error(`Failed to install screen: ${install.stderr || install.stdout}`);
  }
}

async function cleanupScreenSession(
  sandbox: Sandbox,
  sessionName: string,
  screenOutput: string,
): Promise<void> {
  await sandbox.exec(
    `screen -S ${sessionName} -X quit 2>/dev/null || true; rm -f '${screenOutput}'`,
  );
}

async function captureScreen(
  sandbox: Sandbox,
  sessionName: string,
  screenOutput: string,
): Promise<string> {
  await sandbox.exec(`screen -S ${sessionName} -X hardcopy ${screenOutput}`);
  const result = await sandbox.exec(`cat '${screenOutput}' 2>/dev/null || true`);
  return result.stdout;
}

export async function startCodexDeviceLogin(
  sandbox: Sandbox,
  home: string,
  opts?: {
    installCommand?: string;
    sessionName?: string;
    screenOutput?: string;
    maxAttempts?: number;
    intervalMs?: number;
  },
): Promise<CodexDeviceLogin> {
  const installCommand = opts?.installCommand ?? 'apt-get update -qq && apt-get install -y -qq screen';
  const sessionName = opts?.sessionName ?? DEFAULT_SESSION;
  const screenOutput = opts?.screenOutput ?? DEFAULT_SCREEN_OUTPUT;
  const maxAttempts = opts?.maxAttempts ?? 30;
  const intervalMs = opts?.intervalMs ?? 2000;

  await ensureScreenInstalled(sandbox, installCommand);
  await cleanupScreenSession(sandbox, sessionName, screenOutput);
  await sandbox.exec(
    `screen -dmS ${sessionName} bash -lc 'exec codex login --device-auth'`,
  );

  await new Promise(resolve => setTimeout(resolve, 2000));

  let url: string | null = null;
  let code: string | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    const text = await captureScreen(sandbox, sessionName, screenOutput);
    const parsed = parseCodexDeviceAuthOutput(text);
    url = url ?? parsed.url;
    code = code ?? parsed.code;
    if (url && code) break;
  }

  if (!url || !code) {
    const text = await captureScreen(sandbox, sessionName, screenOutput);
    throw new Error(`Failed to detect Codex device code.\nScreen output:\n${text.substring(0, 1000)}`);
  }

  return {
    url,
    code,
    async waitForCredentials(timeoutMs = 10 * 60 * 1000): Promise<string> {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const exists = await sandbox.exec(`test -s '${home}/.codex/auth.json' && echo OK || echo MISSING`);
        if (exists.stdout.trim() === 'OK') {
          const auth = await sandbox.exec(`cat '${home}/.codex/auth.json'`);
          if (auth.exitCode === 0 && auth.stdout.trim()) {
            return auth.stdout;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      throw new Error('Codex auth timeout (10 min)');
    },
    cleanup(): Promise<void> {
      return cleanupScreenSession(sandbox, sessionName, screenOutput);
    },
  };
}
