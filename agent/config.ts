import type {
  AgentConfig,
  AgentMode,
  BridgeConfig,
  FastLiveConfig,
  LLMConfig,
  LLMProvider,
  StrategyMode,
} from './types';

// Reads AgentConfig from the environment. Pure function — tests pass env-like
// records to verify provider selection logic.
export function loadAgentConfig(env: NodeJS.ProcessEnv, argv: string[] = []): AgentConfig {
  const mode = parseMode(env.POKERCLAW_AGENT_MODE);
  const dryRun = argv.includes('--dry-run');
  const pollMs = clampInt(env.POKERCLAW_AGENT_POLL_MS, 250, 5000, 750);
  const serverUrl = env.POKERCLAW_SERVER_URL ?? 'http://127.0.0.1:3001';
  const llm = resolveLLMConfig(env);
  const bridge = resolveBridgeConfig(env);
  const fastLive = resolveFastLiveConfig(env);
  // Backwards compat: if the operator already opted into the OpenClaw bridge
  // via POKERCLAW_AGENT_BRIDGE_ENABLED=true but has not explicitly chosen a
  // POKERCLAW_STRATEGY, treat that as "they want bridge mode" so older shells
  // and .env files keep working.
  const strategyRaw = typeof env.POKERCLAW_STRATEGY === 'string' ? env.POKERCLAW_STRATEGY.trim() : '';
  const strategy: StrategyMode = strategyRaw
    ? parseStrategyMode(strategyRaw)
    : bridge
    ? 'openclaw-bridge'
    : 'fast-live';
  const ruleShortcutsEnabled = parseBoolEnvDefault(env.POKERCLAW_ENABLE_RULE_SHORTCUTS, true);
  const disableFallback = parseBoolEnv(env.POKERCLAW_DISABLE_FALLBACK);
  return {
    serverUrl,
    pollMs,
    mode,
    strategy,
    ruleShortcutsEnabled,
    dryRun,
    disableFallback,
    llm,
    bridge,
    fastLive,
  };
}

// Parses a truthy env value. Accepts "1", "true", "yes" (case-insensitive).
// Everything else (unset, empty, "0", "false") is false.
function parseBoolEnv(raw: string | undefined): boolean {
  if (typeof raw !== 'string') return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

// Same parser but with a configurable default for when the env is unset/empty.
// Explicit "0", "false", "no" still flip to false.
function parseBoolEnvDefault(raw: string | undefined, fallback: boolean): boolean {
  if (typeof raw !== 'string') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '') return fallback;
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  return fallback;
}

// Parses POKERCLAW_STRATEGY into the explicit chain selector. Defaults to
// 'fast-live' so `python poker.py` is playable out of the box.
export function parseStrategyMode(raw: string | undefined): StrategyMode {
  switch ((raw ?? '').toLowerCase().trim()) {
    case 'openclaw-bridge':
    case 'bridge':
    case 'openclaw':
      return 'openclaw-bridge';
    case 'rules':
    case 'rule':
      return 'rules';
    case 'fast-live':
    case 'fastlive':
    case 'fast':
    case '':
      return 'fast-live';
    default:
      return 'fast-live';
  }
}

// Resolves the fast-live config. Same provider/key/url surface as the LLM
// config, but with its own model override (POKERCLAW_FAST_MODEL), a stricter
// timeout (POKERCLAW_FAST_TIMEOUT_MS, default 5000, clamped to [1000, 5000]),
// and a retry budget (POKERCLAW_FAST_MAX_RETRIES, default 1, clamped to [0,3]).
// Returns undefined when there is no usable provider/key — callers fall
// through to rules.
export function resolveFastLiveConfig(env: NodeJS.ProcessEnv): FastLiveConfig | undefined {
  const provider = parseProvider(env.POKERCLAW_AGENT_LLM_PROVIDER);
  if (provider === 'off') return undefined;
  const apiKey = env.POKERCLAW_AGENT_API_KEY?.trim() ?? '';
  if (!apiKey) return undefined;
  const baseModel = env.POKERCLAW_AGENT_MODEL?.trim() ?? '';
  const model = (env.POKERCLAW_FAST_MODEL?.trim() ?? '') || baseModel;
  if (!model) return undefined;
  const apiUrl = (env.POKERCLAW_AGENT_API_URL ?? '').trim() || defaultUrlFor(provider);
  const timeoutMs = clampInt(env.POKERCLAW_FAST_TIMEOUT_MS, 1000, 5000, 5000);
  const maxRetries = clampInt(env.POKERCLAW_FAST_MAX_RETRIES, 0, 3, 1);
  return { provider, apiKey, model, apiUrl, timeoutMs, maxRetries };
}

// Returns a BridgeConfig only when POKERCLAW_AGENT_BRIDGE_ENABLED=true.
// The bridge sidecar URL must be a localhost address — non-localhost URLs
// collapse to `undefined` so we never accidentally point the agent at a
// remote service.
export function resolveBridgeConfig(env: NodeJS.ProcessEnv): BridgeConfig | undefined {
  const enabled = (env.POKERCLAW_AGENT_BRIDGE_ENABLED ?? 'false').toLowerCase().trim() === 'true';
  if (!enabled) return undefined;
  const url = (env.POKERCLAW_AGENT_BRIDGE_URL ?? 'http://127.0.0.1:5179').trim();
  if (!isLocalhostUrl(url)) return undefined;
  // Default 200s so the agent waits long enough for the bridge's 180s CLI
  // timeout plus a small buffer. With a healthy OpenClaw gateway most calls
  // return in <10s; this only matters when the bridge falls back to the
  // embedded agent path.
  const timeoutMs = clampInt(env.POKERCLAW_AGENT_BRIDGE_TIMEOUT_MS, 1000, 300000, 200000);
  const sessionLabel = (env.POKERCLAW_AGENT_BRIDGE_SESSION_LABEL ?? 'moltfire-pokerclaw').trim() ||
    'moltfire-pokerclaw';
  return { url, timeoutMs, sessionLabel };
}

// The sidecar MUST run on the same machine. We allow 127.0.0.1, ::1, and
// `localhost` as a convenience. Node's URL parser preserves the brackets on
// IPv6 hostnames (`[::1]`); strip them before comparing.
export function isLocalhostUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

// Returns an LLMConfig only when the provider is set AND model+key are present.
// Empty/invalid provider strings collapse to `off` and yield `undefined`.
export function resolveLLMConfig(env: NodeJS.ProcessEnv): LLMConfig | undefined {
  const provider = parseProvider(env.POKERCLAW_AGENT_LLM_PROVIDER);
  if (provider === 'off') return undefined;
  const apiKey = env.POKERCLAW_AGENT_API_KEY?.trim() ?? '';
  const model = env.POKERCLAW_AGENT_MODEL?.trim() ?? '';
  if (!apiKey || !model) return undefined;
  const apiUrl = (env.POKERCLAW_AGENT_API_URL ?? '').trim() || defaultUrlFor(provider);
  const timeoutMs = clampInt(env.POKERCLAW_AGENT_TIMEOUT_MS, 1000, 30000, 5000);
  return { provider, apiKey, model, apiUrl, timeoutMs };
}

export function parseProvider(raw: string | undefined): LLMProvider {
  switch ((raw ?? 'off').toLowerCase().trim()) {
    case 'anthropic': return 'anthropic';
    case 'openai-compatible':
    case 'openai': return 'openai-compatible';
    default: return 'off';
  }
}

export function parseMode(raw: string | undefined): AgentMode {
  switch ((raw ?? 'match').toLowerCase()) {
    case 'training': return 'training';
    case 'debug': return 'debug';
    default: return 'match';
  }
}

function defaultUrlFor(provider: Exclude<LLMProvider, 'off'>): string {
  if (provider === 'anthropic') return 'https://api.anthropic.com/v1/messages';
  return 'https://api.openai.com/v1/chat/completions';
}

function clampInt(raw: string | undefined, lo: number, hi: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

// Renders a startup banner so Wes can see at a glance which strategy is live.
// Never contains card data — safe for any mode.
//
// Reflects the *configured* primary strategy, plus the configured fallback
// chain. If the primary path is unreachable at runtime, strategies fall
// through in order — the banner is honest about the configuration, while
// the per-tick logs reveal which strategy actually produced each decision.
export function describeStartup(cfg: AgentConfig): string {
  const tail = `pollMs=${cfg.pollMs} dryRun=${cfg.dryRun}`;
  // Same inference as loadAgentConfig / buildStrategyChain: when cfg.strategy
  // is undefined (test fixtures and back-compat callers), infer from bridge
  // presence so older configs keep working.
  const strategy = cfg.strategy ?? (cfg.bridge ? 'openclaw-bridge' : 'fast-live');
  if (strategy === 'openclaw-bridge' && cfg.bridge) {
    const fallback = cfg.disableFallback ? 'disabled' : cfg.llm ? 'llm,rules' : 'rules';
    return `starting mode=${cfg.mode} strategy=openclaw-bridge sessionLabel=${cfg.bridge.sessionLabel} bridgeUrl=${cfg.bridge.url} fallback=${fallback} ${tail}`;
  }
  if (strategy === 'rules') {
    return `starting mode=${cfg.mode} strategy=rules ${tail}`;
  }
  if (strategy === 'fast-live' && cfg.fastLive) {
    const shortcuts = cfg.ruleShortcutsEnabled ? 'enabled' : 'disabled';
    const fallback = cfg.disableFallback ? 'disabled' : 'rules';
    return `starting mode=${cfg.mode} strategy=fast-live provider=${cfg.fastLive.provider} model=${cfg.fastLive.model} timeoutMs=${cfg.fastLive.timeoutMs} shortcuts=${shortcuts} fallback=${fallback} ${tail}`;
  }
  // strategy=fast-live but no provider configured → degraded to rules.
  if (strategy === 'fast-live') {
    return `starting mode=${cfg.mode} strategy=rules reason=no_fast_model ${tail}`;
  }
  // strategy=openclaw-bridge but bridge env not set → degraded.
  return `starting mode=${cfg.mode} strategy=rules reason=no_bridge_config ${tail}`;
}
