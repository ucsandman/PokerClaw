import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  makeBridgeStrategy,
  buildBridgeRequest,
} from '../agent/strategy/openclaw-bridge';
import { buildStrategyChain } from '../agent/strategy';
import { decideViaChain } from '../agent/strategy';
import { resolveBridgeConfig, isLocalhostUrl, describeStartup, loadAgentConfig } from '../agent/config';
import { buildStrategyInput } from '../agent/strategy-input';
import { startSession, applyAction } from '../shared/game';
import { viewForPlayer } from '../shared/view-models';
import { cardId } from '../shared/cards';
import { seededRand } from './seeded-rand';
import type { BridgeConfig, StrategyInput } from '../agent/types';

const CONFIG = { smallBlind: 50, bigBlind: 100, startingStack: 10000 };

function preflopInput(seed: number): StrategyInput {
  const s = startSession(CONFIG, { button: 'wes', rand: seededRand(seed) });
  applyAction(s, 'wes', { type: 'call' });
  const view = viewForPlayer(s, 'moltfire');
  return buildStrategyInput(view, 'match');
}

// Spin up a tiny HTTP listener on 127.0.0.1 with a configurable handler.
// Yields a BridgeConfig pointed at it. Closed automatically in afterEach.
type ScriptedServer = {
  cfg: BridgeConfig;
  server: http.Server;
  lastBody: unknown;
  lastPath: string | null;
  close: () => Promise<void>;
};

async function startScriptedServer(
  handler: (body: unknown, req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<ScriptedServer> {
  const state: { lastBody: unknown; lastPath: string | null } = {
    lastBody: null,
    lastPath: null,
  };
  const server = http.createServer((req, res) => {
    state.lastPath = req.url ?? null;
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body: unknown = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        body = null;
      }
      state.lastBody = body;
      handler(body, req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const cfg: BridgeConfig = {
    url: `http://127.0.0.1:${port}`,
    timeoutMs: 2000,
    sessionLabel: 'moltfire-pokerclaw-test',
  };
  return {
    cfg,
    server,
    get lastBody() {
      return state.lastBody;
    },
    get lastPath() {
      return state.lastPath;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

describe('bridge config — env loading', () => {
  it('returns undefined when bridge is disabled', () => {
    expect(resolveBridgeConfig({})).toBeUndefined();
    expect(resolveBridgeConfig({ POKERCLAW_AGENT_BRIDGE_ENABLED: 'false' })).toBeUndefined();
  });

  it('builds a config with defaults when enabled', () => {
    const cfg = resolveBridgeConfig({ POKERCLAW_AGENT_BRIDGE_ENABLED: 'true' });
    expect(cfg).toBeDefined();
    expect(cfg!.url).toBe('http://127.0.0.1:5179');
    // 200s default — must cover the bridge's 180s CLI timeout plus a buffer
    // for OpenClaw's embedded-agent fallback path.
    expect(cfg!.timeoutMs).toBe(200000);
    expect(cfg!.sessionLabel).toBe('moltfire-pokerclaw');
  });

  it('honors all env overrides', () => {
    const cfg = resolveBridgeConfig({
      POKERCLAW_AGENT_BRIDGE_ENABLED: 'true',
      POKERCLAW_AGENT_BRIDGE_URL: 'http://localhost:6000',
      POKERCLAW_AGENT_BRIDGE_TIMEOUT_MS: '3000',
      POKERCLAW_AGENT_BRIDGE_SESSION_LABEL: 'mf-dev',
    });
    expect(cfg!.url).toBe('http://localhost:6000');
    expect(cfg!.timeoutMs).toBe(3000);
    expect(cfg!.sessionLabel).toBe('mf-dev');
  });

  it('clamps timeout to [1000, 300000]', () => {
    expect(
      resolveBridgeConfig({
        POKERCLAW_AGENT_BRIDGE_ENABLED: 'true',
        POKERCLAW_AGENT_BRIDGE_TIMEOUT_MS: '999999',
      })!.timeoutMs,
    ).toBe(300000);
    expect(
      resolveBridgeConfig({
        POKERCLAW_AGENT_BRIDGE_ENABLED: 'true',
        POKERCLAW_AGENT_BRIDGE_TIMEOUT_MS: '0',
      })!.timeoutMs,
    ).toBe(1000);
  });

  it('rejects non-localhost URLs', () => {
    expect(
      resolveBridgeConfig({
        POKERCLAW_AGENT_BRIDGE_ENABLED: 'true',
        POKERCLAW_AGENT_BRIDGE_URL: 'http://10.0.0.5:5179',
      }),
    ).toBeUndefined();
    expect(
      resolveBridgeConfig({
        POKERCLAW_AGENT_BRIDGE_ENABLED: 'true',
        POKERCLAW_AGENT_BRIDGE_URL: 'http://example.com:5179',
      }),
    ).toBeUndefined();
  });

  it('recognizes 127.0.0.1, localhost, and ::1 as localhost', () => {
    expect(isLocalhostUrl('http://127.0.0.1:5179')).toBe(true);
    expect(isLocalhostUrl('http://localhost:5179')).toBe(true);
    expect(isLocalhostUrl('http://[::1]:5179')).toBe(true);
    expect(isLocalhostUrl('http://10.0.0.5:5179')).toBe(false);
    expect(isLocalhostUrl('not-a-url')).toBe(false);
  });
});

describe('bridge startup banner', () => {
  it('reports openclaw-bridge as the active strategy when configured', () => {
    const cfg = loadAgentConfig(
      {
        POKERCLAW_AGENT_BRIDGE_ENABLED: 'true',
        POKERCLAW_AGENT_BRIDGE_SESSION_LABEL: 'moltfire-pokerclaw',
      },
      [],
    );
    const line = describeStartup(cfg);
    expect(line).toContain('strategy=openclaw-bridge');
    expect(line).toContain('sessionLabel=moltfire-pokerclaw');
    expect(line).toContain('fallback=rules');
    expect(line).not.toMatch(/[2-9TJQKA][cdhs]/);
  });

  it('lists llm,rules fallback when bridge + LLM are both configured', () => {
    const cfg = loadAgentConfig(
      {
        POKERCLAW_AGENT_BRIDGE_ENABLED: 'true',
        POKERCLAW_AGENT_LLM_PROVIDER: 'anthropic',
        POKERCLAW_AGENT_MODEL: 'claude-x',
        POKERCLAW_AGENT_API_KEY: 'sk-xxx',
      },
      [],
    );
    expect(describeStartup(cfg)).toContain('fallback=llm,rules');
  });
});

describe('bridge adapter — request shaping', () => {
  it('includes all authorized public-hand-context fields', () => {
    const input = preflopInput(701);
    const req = buildBridgeRequest(input, 'moltfire-pokerclaw');
    expect(req.mode).toBe('match');
    const c = req.publicHandContext;
    expect(c.street).toBe(input.street);
    expect(c.pot).toBe(input.pot);
    expect(c.bigBlind).toBe(input.bigBlind);
    expect(c.legalActions).toEqual(input.legalActions);
    expect(c.sessionLabel).toBe('moltfire-pokerclaw');
    expect(Array.isArray(c.actionHistory)).toBe(true);
  });

  it('never includes Wes\'s hole cards in the outgoing payload', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(702) });
    const wesCardIds = s.players.wes.holeCards.map(cardId);
    applyAction(s, 'wes', { type: 'call' });
    const input = buildStrategyInput(viewForPlayer(s, 'moltfire'), 'match');
    const req = buildBridgeRequest(input, 'moltfire-pokerclaw');
    const wire = JSON.stringify(req);
    for (const id of wesCardIds) {
      expect(wire).not.toContain(id);
    }
  });

  it('does include MoltFire\'s own hole cards (the agent needs them)', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(703) });
    const moltCardIds = s.players.moltfire.holeCards.map(cardId);
    applyAction(s, 'wes', { type: 'call' });
    const input = buildStrategyInput(viewForPlayer(s, 'moltfire'), 'match');
    const req = buildBridgeRequest(input, 'moltfire-pokerclaw');
    for (const id of moltCardIds) {
      expect(req.publicHandContext.myHoleCards).toContain(id);
    }
  });
});

describe('bridge adapter — HTTP behaviour', () => {
  const servers: ScriptedServer[] = [];
  beforeEach(() => {
    servers.length = 0;
  });
  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });

  it('returns the parsed decision on a valid 200 JSON response', async () => {
    const srv = await startScriptedServer((_body, _req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ action: { type: 'check' }, rationale: 'value' }));
    });
    servers.push(srv);
    const strategy = makeBridgeStrategy(srv.cfg);
    // BB option preflop after Wes's limp: check is legal, call is not.
    const input = preflopInput(801);
    expect(input.legalActions.check).toBe(true);
    const decision = await strategy.decide(input);
    expect(decision).not.toBeNull();
    expect(decision!.action).toEqual({ type: 'check' });
    expect(decision!.rationale).toBe('value');
    expect(srv.lastPath).toBe('/decide');
  });

  it('returns null when the sidecar responds with a non-2xx', async () => {
    const srv = await startScriptedServer((_body, _req, res) => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'live-bridge-not-wired' }));
    });
    servers.push(srv);
    const decision = await makeBridgeStrategy(srv.cfg).decide(preflopInput(802));
    expect(decision).toBeNull();
  });

  it('returns null when the body is malformed JSON', async () => {
    const srv = await startScriptedServer((_body, _req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not json {{{');
    });
    servers.push(srv);
    const decision = await makeBridgeStrategy(srv.cfg).decide(preflopInput(803));
    expect(decision).toBeNull();
  });

  it('returns null when the action is illegal for the current spot', async () => {
    // Preflop limp from Wes — MoltFire (BB) can check or raise, but not bet
    // (canBet=false because there is already a current bet of bigBlind).
    const srv = await startScriptedServer((_body, _req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ action: { type: 'bet', amount: 200 } }));
    });
    servers.push(srv);
    const decision = await makeBridgeStrategy(srv.cfg).decide(preflopInput(804));
    expect(decision).toBeNull();
  });

  it('clamps a too-large raise into the legal range', async () => {
    const srv = await startScriptedServer((_body, _req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ action: { type: 'raise', amount: 999999 } }));
    });
    servers.push(srv);
    const input = preflopInput(805);
    const decision = await makeBridgeStrategy(srv.cfg).decide(input);
    // Raise is legal preflop facing the limp; max is bounded by stack.
    expect(decision).not.toBeNull();
    if (decision && decision.action.type === 'raise') {
      expect(decision.action.amount).toBeLessThanOrEqual(input.legalActions.maxRaiseTo);
      expect(decision.action.amount).toBeGreaterThanOrEqual(input.legalActions.minRaiseTo);
    } else {
      throw new Error('expected a clamped raise');
    }
  });

  it('returns null on timeout', async () => {
    // Server hangs forever; adapter's AbortController must fire.
    const pending: http.ServerResponse[] = [];
    const srv = await startScriptedServer((_body, _req, res) => {
      pending.push(res);
    });
    servers.push(srv);
    const fastCfg: BridgeConfig = { ...srv.cfg, timeoutMs: 75 };
    const decision = await makeBridgeStrategy(fastCfg).decide(preflopInput(806));
    expect(decision).toBeNull();
    // Release any hung response so the server can close cleanly.
    for (const res of pending) res.end();
  });

  it('returns null when the sidecar is completely unreachable', async () => {
    const cfg: BridgeConfig = {
      url: 'http://127.0.0.1:1',
      timeoutMs: 500,
      sessionLabel: 'moltfire-pokerclaw',
    };
    const decision = await makeBridgeStrategy(cfg).decide(preflopInput(807));
    expect(decision).toBeNull();
  });
});

describe('strategy chain — order and fallback', () => {
  const servers: ScriptedServer[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers.length = 0;
  });

  it('puts openclaw-bridge first when configured', () => {
    const chain = buildStrategyChain({
      serverUrl: 'http://127.0.0.1:3001',
      pollMs: 750,
      mode: 'match',
      dryRun: false,
      bridge: {
        url: 'http://127.0.0.1:5179',
        timeoutMs: 1000,
        sessionLabel: 'moltfire-pokerclaw',
      },
    });
    expect(chain.map((s) => s.name)).toEqual([
      'openclaw-bridge',
      'rules',
      'safe-fallback',
    ]);
  });

  it('places the bridge above llm when both are configured', () => {
    const chain = buildStrategyChain({
      serverUrl: 'http://127.0.0.1:3001',
      pollMs: 750,
      mode: 'match',
      dryRun: false,
      bridge: {
        url: 'http://127.0.0.1:5179',
        timeoutMs: 1000,
        sessionLabel: 'moltfire-pokerclaw',
      },
      llm: {
        provider: 'anthropic',
        apiUrl: 'https://api.anthropic.com/v1/messages',
        apiKey: 'sk-xxx',
        model: 'claude-x',
        timeoutMs: 5000,
      },
    });
    expect(chain.map((s) => s.name)).toEqual([
      'openclaw-bridge',
      'llm:anthropic',
      'rules',
      'safe-fallback',
    ]);
  });

  it('omits the bridge when disabled (default chain is fast-live shape)', () => {
    // Default cfg with no explicit strategy → buildStrategyChain infers
    // 'fast-live' since cfg.bridge is undefined. With no fastLive config the
    // model layer is skipped, but the rule-shortcut layer is still present
    // because it has no provider dependency.
    const chain = buildStrategyChain({
      serverUrl: 'http://127.0.0.1:3001',
      pollMs: 750,
      mode: 'match',
      dryRun: false,
    });
    expect(chain.map((s) => s.name)).toEqual(['rules-shortcut', 'rules', 'safe-fallback']);
  });

  it('uses the bridge when it returns a valid decision', async () => {
    const srv = await startScriptedServer((_body, _req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ action: { type: 'check' } }));
    });
    servers.push(srv);
    // Reach a flop spot where MoltFire can check.
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(901) });
    applyAction(s, 'wes', { type: 'call' });
    applyAction(s, 'moltfire', { type: 'check' });
    const input = buildStrategyInput(viewForPlayer(s, 'moltfire'), 'match');
    const chain = buildStrategyChain({
      serverUrl: 'http://127.0.0.1:3001',
      pollMs: 750,
      mode: 'match',
      dryRun: false,
      bridge: srv.cfg,
    });
    const result = await decideViaChain(chain, input);
    expect(result.strategy).toBe('openclaw-bridge');
    expect(result.decision?.action).toEqual({ type: 'check' });
  });

  it('falls through to rules when the bridge returns 502', async () => {
    const srv = await startScriptedServer((_body, _req, res) => {
      res.writeHead(502);
      res.end(JSON.stringify({ error: 'live-bridge-not-wired' }));
    });
    servers.push(srv);
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(902) });
    applyAction(s, 'wes', { type: 'call' });
    const input = buildStrategyInput(viewForPlayer(s, 'moltfire'), 'match');
    const chain = buildStrategyChain({
      serverUrl: 'http://127.0.0.1:3001',
      pollMs: 750,
      mode: 'match',
      dryRun: false,
      bridge: srv.cfg,
    });
    const result = await decideViaChain(chain, input);
    expect(result.strategy).toBe('rules');
    expect(result.decision).not.toBeNull();
  });
});

// -----------------------------------------------------------------------
// End-to-end: spawn the real sidecar in dry-run mode and POST /decide.
// This is the proof that bridge sidecar dry-run mode works end-to-end with
// the agent's adapter — no LLM, no OpenClaw, just deterministic legal action.
// -----------------------------------------------------------------------

describe('sidecar dry-run mode — end-to-end', () => {
  let child: ChildProcess | null = null;
  let port = 0;

  beforeEach(async () => {
    port = 5200 + Math.floor(Math.random() * 200);
    const sidecarPath = path.resolve(
      fileURLToPath(new URL('../bridge/moltfire-bridge.mjs', import.meta.url)),
    );
    child = spawn(process.execPath, [sidecarPath, '--dry-run'], {
      env: {
        ...process.env,
        POKERCLAW_BRIDGE_PORT: String(port),
        POKERCLAW_AGENT_BRIDGE_SESSION_LABEL: 'moltfire-pokerclaw-test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Drain stdout/stderr so the child doesn't block on a full pipe buffer.
    child.stdout?.on('data', () => undefined);
    child.stderr?.on('data', () => undefined);
    await waitForHealth(`http://127.0.0.1:${port}/health`, 5000);
  });

  afterEach(async () => {
    if (child && !child.killed) {
      child.kill('SIGINT');
      await new Promise<void>((resolve) => {
        if (!child) return resolve();
        child.once('exit', () => resolve());
        // Force-kill fallback after 1s if SIGINT isn't honored on Windows.
        setTimeout(() => {
          if (child && !child.killed) child.kill();
          resolve();
        }, 1000);
      });
      child = null;
    }
  });

  it('responds 200 with a deterministic legal action via the live adapter', async () => {
    const input = preflopInput(1001);
    const cfg: BridgeConfig = {
      url: `http://127.0.0.1:${port}`,
      timeoutMs: 3000,
      sessionLabel: 'moltfire-pokerclaw-test',
    };
    const decision = await makeBridgeStrategy(cfg).decide(input);
    expect(decision).not.toBeNull();
    // The dry-run ladder returns one of: check, cheap call, min bet, fold, call.
    // Validate the returned action is legal for the spot — the same gate the
    // adapter's coerceAction applies.
    if (!decision) throw new Error('null decision');
    const legal = input.legalActions;
    switch (decision.action.type) {
      case 'check':
        expect(legal.check).toBe(true);
        break;
      case 'call':
        expect(legal.call).toBe(true);
        break;
      case 'bet':
        expect(legal.canBet).toBe(true);
        expect(decision.action.amount).toBeGreaterThanOrEqual(legal.minBetTo);
        expect(decision.action.amount).toBeLessThanOrEqual(legal.maxBetTo);
        break;
      case 'fold':
        expect(legal.fold).toBe(true);
        break;
      default:
        throw new Error(`unexpected action type: ${(decision.action as { type: string }).type}`);
    }
  });

  it('reports dry-run mode and the session label on /health', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const body = (await res.json()) as { ok: boolean; mode: string; sessionLabel: string };
    expect(body.ok).toBe(true);
    expect(body.mode).toBe('dry-run');
    expect(body.sessionLabel).toBe('moltfire-pokerclaw-test');
  });
});

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 75));
  }
  throw new Error(`sidecar /health never responded: ${String(lastErr)}`);
}
