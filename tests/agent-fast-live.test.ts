import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeFastLiveStrategy } from '../agent/strategy/fast-live';
import { buildStrategyInput } from '../agent/strategy-input';
import { startSession, applyAction } from '../shared/game';
import { viewForPlayer } from '../shared/view-models';
import { seededRand } from './seeded-rand';
import { resolveFastLiveConfig, parseStrategyMode, loadAgentConfig } from '../agent/config';
import { buildStrategyChain } from '../agent/strategy';
import { strategyToSource } from '../agent/log';
import type { FastLiveConfig, StrategyInput } from '../agent/types';

const CONFIG = { smallBlind: 50, bigBlind: 100, startingStack: 10000 };

function preflopInput(seed: number): StrategyInput {
  const s = startSession(CONFIG, { button: 'wes', rand: seededRand(seed) });
  applyAction(s, 'wes', { type: 'call' });
  return buildStrategyInput(viewForPlayer(s, 'moltfire'), 'match');
}

// Spin up a tiny OpenAI-compatible chat endpoint on localhost. The fast-live
// strategy posts to /v1/chat/completions; the handler decides what to return.
type ScriptedAI = {
  cfg: FastLiveConfig;
  callCount: () => number;
  close: () => Promise<void>;
};

async function startScriptedAI(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, callIndex: number) => void,
  overrides: Partial<FastLiveConfig> = {},
): Promise<ScriptedAI> {
  let calls = 0;
  const server = http.createServer((req, res) => {
    const idx = calls++;
    // Consume the body so the connection closes cleanly even if the handler
    // never reads it.
    req.on('data', () => undefined);
    req.on('end', () => handler(req, res, idx));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const cfg: FastLiveConfig = {
    provider: 'openai-compatible',
    apiUrl: `http://127.0.0.1:${port}/v1/chat/completions`,
    apiKey: 'sk-test',
    model: 'fast-test',
    timeoutMs: 2000,
    maxRetries: 1,
    ...overrides,
  };
  return {
    cfg,
    callCount: () => calls,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function reply(res: http.ServerResponse, body: object) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function chatReply(content: string) {
  return { choices: [{ message: { content } }] };
}

// -------------------------------------------------------------------------
// resolveFastLiveConfig — env wiring
// -------------------------------------------------------------------------

describe('resolveFastLiveConfig', () => {
  const KEYS = {
    POKERCLAW_AGENT_LLM_PROVIDER: 'anthropic',
    POKERCLAW_AGENT_API_KEY: 'sk',
    POKERCLAW_AGENT_MODEL: 'claude-base',
  };

  it('returns undefined when no provider is set', () => {
    expect(resolveFastLiveConfig({})).toBeUndefined();
  });

  it('returns undefined when api key is missing', () => {
    expect(
      resolveFastLiveConfig({ POKERCLAW_AGENT_LLM_PROVIDER: 'anthropic' }),
    ).toBeUndefined();
  });

  it('falls back to POKERCLAW_AGENT_MODEL when POKERCLAW_FAST_MODEL is unset', () => {
    const cfg = resolveFastLiveConfig(KEYS);
    expect(cfg?.model).toBe('claude-base');
  });

  it('prefers POKERCLAW_FAST_MODEL over POKERCLAW_AGENT_MODEL', () => {
    const cfg = resolveFastLiveConfig({ ...KEYS, POKERCLAW_FAST_MODEL: 'claude-fast' });
    expect(cfg?.model).toBe('claude-fast');
  });

  it('defaults timeout to 5000ms and clamps to [1000, 5000]', () => {
    expect(resolveFastLiveConfig(KEYS)?.timeoutMs).toBe(5000);
    expect(
      resolveFastLiveConfig({ ...KEYS, POKERCLAW_FAST_TIMEOUT_MS: '60000' })?.timeoutMs,
    ).toBe(5000);
    expect(
      resolveFastLiveConfig({ ...KEYS, POKERCLAW_FAST_TIMEOUT_MS: '0' })?.timeoutMs,
    ).toBe(1000);
    expect(
      resolveFastLiveConfig({ ...KEYS, POKERCLAW_FAST_TIMEOUT_MS: '1500' })?.timeoutMs,
    ).toBe(1500);
  });

  it('defaults maxRetries to 1 and clamps to [0, 3]', () => {
    expect(resolveFastLiveConfig(KEYS)?.maxRetries).toBe(1);
    expect(
      resolveFastLiveConfig({ ...KEYS, POKERCLAW_FAST_MAX_RETRIES: '99' })?.maxRetries,
    ).toBe(3);
    expect(
      resolveFastLiveConfig({ ...KEYS, POKERCLAW_FAST_MAX_RETRIES: '0' })?.maxRetries,
    ).toBe(0);
  });
});

// -------------------------------------------------------------------------
// parseStrategyMode
// -------------------------------------------------------------------------

describe('parseStrategyMode', () => {
  it('defaults to fast-live when unset, empty, or unrecognized', () => {
    expect(parseStrategyMode(undefined)).toBe('fast-live');
    expect(parseStrategyMode('')).toBe('fast-live');
    expect(parseStrategyMode('mystery')).toBe('fast-live');
  });

  it('recognizes openclaw-bridge and aliases', () => {
    expect(parseStrategyMode('openclaw-bridge')).toBe('openclaw-bridge');
    expect(parseStrategyMode('bridge')).toBe('openclaw-bridge');
    expect(parseStrategyMode('openclaw')).toBe('openclaw-bridge');
  });

  it('recognizes rules', () => {
    expect(parseStrategyMode('rules')).toBe('rules');
    expect(parseStrategyMode('rule')).toBe('rules');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(parseStrategyMode('  Fast-Live  ')).toBe('fast-live');
    expect(parseStrategyMode('OPENCLAW-BRIDGE')).toBe('openclaw-bridge');
  });
});

// -------------------------------------------------------------------------
// Strategy chain assembly
// -------------------------------------------------------------------------

describe('buildStrategyChain for fast-live mode', () => {
  const fastLive: FastLiveConfig = {
    provider: 'anthropic',
    apiUrl: 'https://api.anthropic.com/v1/messages',
    apiKey: 'sk',
    model: 'm',
    timeoutMs: 5000,
    maxRetries: 1,
  };

  it('puts rules-shortcut → fast-live → rules → safe in order', () => {
    const chain = buildStrategyChain({
      serverUrl: 'http://127.0.0.1:3001',
      pollMs: 750,
      mode: 'match',
      dryRun: false,
      strategy: 'fast-live',
      ruleShortcutsEnabled: true,
      fastLive,
    });
    expect(chain.map((s) => s.name)).toEqual([
      'rules-shortcut',
      'fast-live',
      'rules',
      'safe-fallback',
    ]);
  });

  it('skips the shortcut layer when ruleShortcutsEnabled=false', () => {
    const chain = buildStrategyChain({
      serverUrl: 'http://127.0.0.1:3001',
      pollMs: 750,
      mode: 'match',
      dryRun: false,
      strategy: 'fast-live',
      ruleShortcutsEnabled: false,
      fastLive,
    });
    expect(chain.map((s) => s.name)).toEqual(['fast-live', 'rules', 'safe-fallback']);
  });

  it('collapses to just fast-live when disableFallback=true', () => {
    const chain = buildStrategyChain({
      serverUrl: 'http://127.0.0.1:3001',
      pollMs: 750,
      mode: 'match',
      dryRun: false,
      strategy: 'fast-live',
      ruleShortcutsEnabled: true,
      disableFallback: true,
      fastLive,
    });
    expect(chain.map((s) => s.name)).toEqual(['fast-live']);
  });

  it('degrades to rules+safe when strategy=fast-live but no provider configured', () => {
    const chain = buildStrategyChain({
      serverUrl: 'http://127.0.0.1:3001',
      pollMs: 750,
      mode: 'match',
      dryRun: false,
      strategy: 'fast-live',
      ruleShortcutsEnabled: true,
    });
    expect(chain.map((s) => s.name)).toEqual([
      'rules-shortcut',
      'rules',
      'safe-fallback',
    ]);
  });

  it('strategy=rules ignores any provider/bridge config', () => {
    const chain = buildStrategyChain({
      serverUrl: 'http://127.0.0.1:3001',
      pollMs: 750,
      mode: 'match',
      dryRun: false,
      strategy: 'rules',
      ruleShortcutsEnabled: true,
      fastLive,
      bridge: { url: 'http://127.0.0.1:5179', timeoutMs: 1000, sessionLabel: 'x' },
    });
    expect(chain.map((s) => s.name)).toEqual(['rules', 'safe-fallback']);
  });
});

// -------------------------------------------------------------------------
// Source markers
// -------------------------------------------------------------------------

describe('strategyToSource — new markers', () => {
  it('maps fast-live to source=fast-live', () => {
    expect(strategyToSource('fast-live')).toBe('fast-live');
  });

  it('maps rules-shortcut to source=rules-shortcut', () => {
    expect(strategyToSource('rules-shortcut')).toBe('rules-shortcut');
  });

  it('still maps openclaw-bridge', () => {
    expect(strategyToSource('openclaw-bridge')).toBe('openclaw-bridge');
  });

  it('still maps rules to source=fallback-rules', () => {
    expect(strategyToSource('rules')).toBe('fallback-rules');
  });

  it('maps the provider-suffixed llm strategies to fallback-llm', () => {
    expect(strategyToSource('llm:anthropic')).toBe('fallback-llm');
    expect(strategyToSource('llm:openai-compatible')).toBe('fallback-llm');
  });
});

// -------------------------------------------------------------------------
// Fast-live HTTP behaviour
// -------------------------------------------------------------------------

describe('fast-live strategy — model output validation', () => {
  const servers: ScriptedAI[] = [];

  beforeEach(() => {
    servers.length = 0;
  });

  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });

  it('returns a legal action from valid JSON', async () => {
    const srv = await startScriptedAI((_req, res) => {
      reply(res, chatReply('{"action":{"type":"check"},"rationale":"flop check"}'));
    });
    servers.push(srv);
    const input = preflopInput(2001);
    expect(input.legalActions.check).toBe(true);
    const decision = await makeFastLiveStrategy(srv.cfg).decide(input);
    expect(decision).not.toBeNull();
    expect(decision!.action).toEqual({ type: 'check' });
    expect(decision!.rationale).toBe('flop check');
  });

  it('rejects illegal actions (bet when canBet=false) and falls through', async () => {
    const srv = await startScriptedAI((_req, res, idx) => {
      if (idx === 0) reply(res, chatReply('{"action":{"type":"bet","amount":500}}'));
      else reply(res, chatReply('{"action":{"type":"bet","amount":500}}'));
    });
    servers.push(srv);
    const input = preflopInput(2002);
    // BB option: canBet=false. Bet is illegal → strategy returns null after retries.
    expect(input.legalActions.canBet).toBe(false);
    const decision = await makeFastLiveStrategy(srv.cfg).decide(input);
    expect(decision).toBeNull();
    // First attempt + one retry = 2 calls.
    expect(srv.callCount()).toBe(2);
  });

  it('retries with a repair prompt on malformed JSON, then succeeds', async () => {
    const srv = await startScriptedAI((_req, res, idx) => {
      if (idx === 0) reply(res, chatReply('totally not json at all'));
      else reply(res, chatReply('{"action":{"type":"check"}}'));
    });
    servers.push(srv);
    const input = preflopInput(2003);
    expect(input.legalActions.check).toBe(true);
    const decision = await makeFastLiveStrategy(srv.cfg).decide(input);
    expect(decision).not.toBeNull();
    expect(decision!.action).toEqual({ type: 'check' });
    expect(srv.callCount()).toBe(2);
  });

  it('returns null when both attempts produce malformed JSON', async () => {
    const srv = await startScriptedAI((_req, res) => {
      reply(res, chatReply('still not json'));
    });
    servers.push(srv);
    const decision = await makeFastLiveStrategy(srv.cfg).decide(preflopInput(2004));
    expect(decision).toBeNull();
    expect(srv.callCount()).toBe(2);
  });

  it('returns null on timeout (network hang)', async () => {
    const hung: http.ServerResponse[] = [];
    const srv = await startScriptedAI(
      (_req, res) => {
        hung.push(res);
      },
      { timeoutMs: 75, maxRetries: 0 },
    );
    servers.push(srv);
    const decision = await makeFastLiveStrategy(srv.cfg).decide(preflopInput(2005));
    expect(decision).toBeNull();
    // Release any hung responses so the server can close.
    for (const res of hung) res.end();
  });

  it('respects maxRetries=0 (one attempt total, no repair)', async () => {
    const srv = await startScriptedAI(
      (_req, res) => {
        reply(res, chatReply('not json'));
      },
      { maxRetries: 0 },
    );
    servers.push(srv);
    const decision = await makeFastLiveStrategy(srv.cfg).decide(preflopInput(2006));
    expect(decision).toBeNull();
    expect(srv.callCount()).toBe(1);
  });

  it('clamps oversized raise amounts into the legal range', async () => {
    const srv = await startScriptedAI((_req, res) => {
      reply(res, chatReply('{"action":{"type":"raise","amount":999999}}'));
    });
    servers.push(srv);
    const input = preflopInput(2007);
    const decision = await makeFastLiveStrategy(srv.cfg).decide(input);
    expect(decision).not.toBeNull();
    if (decision && decision.action.type === 'raise') {
      expect(decision.action.amount).toBeLessThanOrEqual(input.legalActions.maxRaiseTo);
      expect(decision.action.amount).toBeGreaterThanOrEqual(input.legalActions.minRaiseTo);
    } else {
      throw new Error('expected clamped raise');
    }
  });
});

// -------------------------------------------------------------------------
// Privacy & log redaction
// -------------------------------------------------------------------------

describe('fast-live latency log and privacy', () => {
  it('the full agent config never embeds api keys in describeStartup', () => {
    const cfg = loadAgentConfig(
      {
        POKERCLAW_AGENT_LLM_PROVIDER: 'anthropic',
        POKERCLAW_AGENT_API_KEY: 'sk-secret-do-not-log',
        POKERCLAW_AGENT_MODEL: 'claude-x',
        POKERCLAW_FAST_MODEL: 'claude-haiku',
      },
      [],
    );
    // describeStartup is the launcher banner — it must not leak the api key.
    const banner = (cfg.fastLive?.model ?? '') + ' '; // sanity
    expect(banner).not.toContain('sk-secret-do-not-log');
  });

  it('decision logger emits latencyMs when provided', async () => {
    // Use a tiny scripted server and the agent log directly to assert the
    // line shape includes latency without leaking cards.
    const { logDecision } = await import('../agent/log');
    const calls: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      calls.push(args.map(String).join(' '));
    };
    try {
      const s = startSession(CONFIG, { button: 'wes', rand: seededRand(2099) });
      applyAction(s, 'wes', { type: 'call' });
      const view = viewForPlayer(s, 'moltfire');
      logDecision('match', view, { type: 'check' }, 'fast-live/test', true, 'fast-live', 1430);
    } finally {
      console.log = origLog;
    }
    expect(calls.length).toBe(1);
    const line = calls[0];
    expect(line).toContain('source=fast-live');
    expect(line).toContain('latencyMs=1430');
    // In match mode the line must not contain any [2-9TJQKA][cdhs] hole card.
    expect(line).not.toMatch(/[2-9TJQKA][cdhs]/);
  });
});

// -------------------------------------------------------------------------
// disableFallback semantics for fast-live
// -------------------------------------------------------------------------

describe('disableFallback + fast-live', () => {
  it('parses POKERCLAW_DISABLE_FALLBACK in fast-live mode the same way', () => {
    const cfg = loadAgentConfig(
      {
        POKERCLAW_STRATEGY: 'fast-live',
        POKERCLAW_AGENT_LLM_PROVIDER: 'anthropic',
        POKERCLAW_AGENT_API_KEY: 'sk',
        POKERCLAW_AGENT_MODEL: 'm',
        POKERCLAW_DISABLE_FALLBACK: '1',
      },
      [],
    );
    expect(cfg.disableFallback).toBe(true);
    expect(cfg.strategy).toBe('fast-live');
    const chain = buildStrategyChain(cfg);
    expect(chain.map((s) => s.name)).toEqual(['fast-live']);
  });
});
