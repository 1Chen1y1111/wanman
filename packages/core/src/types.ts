/** Agent lifecycle mode */
export type AgentLifecycle = '24/7' | 'on-demand';

/** Agent runtime backend */
export type AgentRuntime = 'claude' | 'codex';

/** Codex reasoning effort / speed tier */
export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

/** Model identifier — runtime-dependent (e.g. 'claude-opus-4-6', 'o3', 'o4-mini') */
export type ModelTier = string;

/** Message priority — steer interrupts current work, normal waits */
export type MessagePriority = 'steer' | 'normal';

/** Agent process state */
export type AgentState = 'idle' | 'running' | 'paused' | 'stopped' | 'error';

/** Coarse task/capsule work type */
export type TaskScopeType = 'code' | 'docs' | 'tests' | 'ops' | 'mixed';

/** Mission-board initiative state */
export type InitiativeStatus = 'active' | 'paused' | 'completed' | 'abandoned';

/** PR-sized change capsule state */
export type ChangeCapsuleStatus = 'open' | 'in_review' | 'merged' | 'abandoned';

/** Agent definition — loaded from agents.json config */
export interface AgentDefinition {
  name: string;
  lifecycle: AgentLifecycle;
  /** Runtime backend used to execute the agent process */
  runtime?: AgentRuntime;
  model: ModelTier;
  systemPrompt: string;
  /** Cron expressions for scheduled triggers */
  crons?: string[];
  /** Event types this agent subscribes to */
  events?: string[];
  /** Override ANTHROPIC_BASE_URL for this agent (e.g. LM Studio endpoint) */
  baseUrl?: string;
  /** Override ANTHROPIC_AUTH_TOKEN for this agent */
  apiKey?: string;
}

/** A message between agents or from external sources */
export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  /** Message type (e.g. 'message', 'event', 'cron') */
  type: string;
  /** Structured payload */
  payload: unknown;
  priority: MessagePriority;
  timestamp: number;
  delivered: boolean;
}

/** Shared context entry — key-value store for inter-agent state */
export interface ContextEntry {
  key: string;
  value: string;
  updatedBy: string;
  updatedAt: number;
}

/** db9 Brain persistent memory config */
export interface BrainConfig {
  /** db9.ai API token (env: DB9_TOKEN) */
  token: string;
  /** Database name */
  dbName: string;
  /** db9 API base URL */
  baseUrl?: string;
}

/** Sandbank relay config */
export interface RelayConfig {
  /** Relay port (default: 3122) */
  port?: number;
}

/** Top-level config loaded from agents.json */
export interface AgentMatrixConfig {
  agents: AgentDefinition[];
  /** SQLite database path */
  dbPath?: string;
  /** HTTP server port */
  port?: number;
  /** Workspace root for agent working directories */
  workspaceRoot?: string;
  /** Git root for repo-aware runs (defaults from workspaceRoot) */
  gitRoot?: string;
  /** db9 Brain persistent memory config (optional) */
  brain?: BrainConfig;
  /** Sandbank relay config. If present, uses Sandbank relay instead of SQLite. */
  relay?: RelayConfig;
  /** Top-level goal for the CEO agent to pursue autonomously */
  goal?: string;
}

/** External event pushed into the agent matrix */
export interface ExternalEvent {
  type: string;
  source: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

/** Long-running product initiative tracked during takeover */
export interface Initiative {
  id: string;
  title: string;
  goal: string;
  summary: string;
  status: InitiativeStatus;
  priority: number;
  sources: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/** PR-sized change package linked to a branch */
export interface ChangeCapsule {
  id: string;
  goal: string;
  ownerAgent: string;
  branch: string;
  baseCommit: string;
  allowedPaths: string[];
  acceptance: string;
  reviewer: string;
  status: ChangeCapsuleStatus;
  createdAt: number;
  updatedAt: number;
  initiativeId?: string;
  taskId?: string;
  subsystem?: string;
  scopeType?: TaskScopeType;
  blockedBy?: string[];
  supersedes?: string;
}

// ── Auth types ──

/** Supported CLI auth providers */
export type AuthProviderName = 'stripe' | 'github' | 'cloudflare' | 'claude' | 'codex';

/** Auth status for a provider */
export type AuthStatus = 'authenticated' | 'unauthenticated' | 'pending' | 'error';

/** Story run lifecycle state shared between API and web surfaces */
export type StoryRunStatus =
  | 'pending'
  | 'provisioning'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Supported control actions for a story-backed run */
export type StoryRunControlAction = 'start' | 'pause' | 'resume' | 'stop';

/** Actor responsible for a story run lifecycle event */
export type StoryRunActor = 'system' | 'runtime' | 'operator';

/** Cross-surface launch kind for the control plane */
export type LaunchKind = 'run' | 'takeover';

/** Execution mode requested by a client */
export type LaunchMode = 'sandbox' | 'local';

/** Lifecycle state for a queued launch request */
export type LaunchStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Strategy for accessing a takeover repository from the launch runner */
export type TakeoverRepoAuth = 'public' | 'runner_env' | 'github_app';

/** Actor responsible for a launch timeline event */
export type LaunchEventActor = 'system' | 'runner' | 'operator';

/** Auth provider info returned by auth.* RPC methods */
export interface AuthProviderInfo {
  name: AuthProviderName;
  status: AuthStatus;
  loginUrl?: string;
  loginCode?: string;
  error?: string;
}

/** Health check response */
export interface HealthResponse {
  status: 'ok';
  agents: Array<{
    name: string;
    state: AgentState;
    lifecycle: AgentLifecycle;
  }>;
  timestamp: string;
}

// ── Web/API DTOs ──

/** Public run launch input accepted by the control plane */
export interface RunLaunchInputRecord {
  goal: string;
  mode?: LaunchMode;
  runtime?: AgentRuntime;
  loops?: number | null;
  infinite?: boolean;
  poll_interval?: number;
  keep?: boolean;
  no_brain?: boolean;
  output?: string | null;
  codex_model?: string | null;
  codex_reasoning_effort?: CodexReasoningEffort | null;
}

/** Public takeover launch input accepted by the control plane */
export interface TakeoverLaunchInputRecord {
  repo_url: string;
  repo_ref?: string | null;
  goal_override?: string | null;
  repo_auth?: TakeoverRepoAuth;
  github_installation_id?: number | null;
  mode?: LaunchMode;
  runtime?: AgentRuntime;
  loops?: number | null;
  infinite?: boolean;
  poll_interval?: number;
  keep?: boolean;
  enable_brain?: boolean;
  output?: string | null;
  codex_model?: string | null;
  codex_reasoning_effort?: CodexReasoningEffort | null;
}

/** Serialized launch payload stored by the control plane */
export type LaunchPayloadRecord = RunLaunchInputRecord | TakeoverLaunchInputRecord;

/** Queued launch record shared across control-plane clients */
export interface LaunchRecord {
  id: string;
  user_id: string;
  story_id?: string | null;
  kind: LaunchKind;
  status: LaunchStatus;
  mode: LaunchMode;
  runtime: AgentRuntime | null;
  goal: string | null;
  repo_url: string | null;
  repo_ref: string | null;
  output_path: string | null;
  error: string | null;
  payload: LaunchPayloadRecord;
  attempt_count: number;
  max_attempts: number;
  created_at: number;
  updated_at: number;
  heartbeat_at: number | null;
  started_at: number | null;
  completed_at: number | null;
}

/** Append-only launch timeline event */
export interface LaunchEventRecord {
  id: number;
  launch_id: string;
  actor: LaunchEventActor;
  event_type: string;
  message: string | null;
  payload: unknown | null;
  created_at: number;
}

/** Launch detail projection with full timeline */
export interface LaunchDetailRecord extends LaunchRecord {
  timeline: LaunchEventRecord[];
}

/** Parsed SSE message emitted by the launch stream */
export interface LaunchStreamMessageRecord {
  eventType: string;
  data: unknown;
}

/** GitHub App auth status visible to Web/CLI/native clients */
export interface GitHubConnectionStatusRecord {
  connected: boolean;
  github_login: string | null;
  github_avatar_url: string | null;
  install_url: string | null;
}

/** GitHub App installation visible to the current user */
export interface GitHubInstallationRecord {
  id: number;
  account_login: string;
  account_type: string;
  account_avatar_url: string;
  repository_selection: string;
}

/** GitHub repository visible through one installation */
export interface GitHubRepoRecord {
  id: number;
  name: string;
  full_name: string;
  owner: string;
  description: string | null;
  default_branch: string;
  private: boolean;
  html_url: string;
  language: string | null;
  updated_at: string;
}

/** Internal claim returned to a trusted launch runner */
export interface LaunchClaimRecord {
  launch: LaunchRecord;
  claim_token: string;
}

/** Story record shared between API responses and the web app */
export interface StoryRecord {
  id: string;
  user_id: string;
  launch_id: string | null;
  name: string;
  goal: string;
  repo_url: string | null;
  status: StoryRunStatus;
  mode: string;
  provider: AgentRuntime | null;
  sandbox_id: string | null;
  sandbox_url: string | null;
  run_id: string | null;
  config: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
}

/** Story artifact record shared between API responses and the web app */
export interface StoryArtifactRecord {
  id: string;
  story_id: string;
  agent: string | null;
  kind: string;
  path: string;
  content: string | null;
  metadata: string | null;
  created_at: number;
}

/** Story task snapshot shared between API responses and the web app */
export interface StoryTaskRecord {
  id: string;
  title?: string;
  status?: string;
  assignee?: string;
  result?: unknown;
}

/** Structured thread kinds used by user-facing story composer flows */
export type StoryThreadComposeType = 'message' | 'decision' | 'blocker';

/** Lifecycle state for a user-visible thread card */
export type StoryThreadStatus = 'open' | 'resolved';

/** Story-bound agent or human thread message projected for product surfaces */
export interface StoryThreadMessageRecord {
  id: number;
  story_id: string;
  from: string;
  to: string | null;
  message_type: string;
  priority: MessagePriority | null;
  text: string | null;
  payload: unknown | null;
  created_at: number;
  status?: StoryThreadStatus;
  resolved_at?: number | null;
  resolution_thread_id?: number | null;
}

/** Story run record shared between API responses and the web app */
export interface StoryRunRecord {
  id: string;
  story_id: string;
  status: StoryRunStatus;
  sandbox_id: string | null;
  sandbox_url: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

/** Story run event record shared between API responses and the web app */
export interface StoryRunEventRecord {
  id: number;
  story_id: string;
  run_id: string;
  event_type: string;
  status: StoryRunStatus | null;
  actor: StoryRunActor | null;
  payload: unknown | null;
  created_at: number;
}

/** Current run projection shared between API responses and the web app */
export interface StoryRunDetailRecord extends StoryRunRecord {
  timeline: StoryRunEventRecord[];
}

/** Story record augmented with the current run projection when available */
export interface StoryViewRecord extends StoryRecord {
  current_run?: StoryRunRecord | StoryRunDetailRecord | null;
  threads?: StoryThreadMessageRecord[];
}

/** Story summary projection shared between API responses and the web app */
export interface StorySummaryRecord extends StoryViewRecord {
  taskSummaries: string[];
  artifactCount: number;
  agentCount: number;
  openDecisionCount: number;
  openBlockerCount: number;
  current_run: StoryRunRecord | null;
}

/** Story detail projection shared between API responses and the web app */
export interface StoryDetailRecord extends StoryViewRecord {
  artifacts: StoryArtifactRecord[];
  tasks: StoryTaskRecord[];
  current_run: StoryRunDetailRecord | null;
}

/** Current run envelope shared between API responses and the web app */
export interface CurrentStoryRunResponseRecord {
  current_run: StoryRunDetailRecord | null;
}

/** Story run control response shared between API responses and the web app */
export interface StoryRunControlResponseRecord {
  status: StoryRunStatus;
  current_run: StoryRunRecord | null;
}

/** Parsed SSE message emitted by the story stream */
export interface StoryStreamMessageRecord {
  eventType: string;
  data: unknown;
}

/** Connected provider info returned by the API */
export interface ProviderInfo {
  provider: AgentRuntime;
  connected: boolean;
  expires_at: number | null;
  updated_at: number | null;
}

/** Provider heartbeat state returned by the API */
export interface ProviderHeartbeatStatus {
  online: boolean;
  sandbox_id?: string;
  token_valid?: boolean;
}
