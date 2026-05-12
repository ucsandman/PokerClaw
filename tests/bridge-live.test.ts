import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// @ts-expect-error — importing the bridge .mjs for unit tests; no .d.ts ship.
import * as bridge from '../bridge/moltfire-bridge.mjs';
import { startSession, applyAction } from '../shared/game';
import { viewForPlayer } from '../shared/view-models';
import { cardId } from '../shared/cards';
import { buildStrategyInput } from '../agent/strategy-input';
import { buildBridgeRequest } from '../agent/strategy/openclaw-bridge';
import { seededRand } from './seeded-rand';

const CONFIG = { smallBlind: 50, bigBlind: 100, startingStack: 10000 };

function preflopCtx(seed: number) {
  const s = startSession(CONFIG, { button: 'wes', rand: seededRand(seed) });
  applyAction(s, 'wes', { type: 'call' });
  const view = viewForPlayer(s, 'moltfire');
  const input = buildStrategyInput(view, 'match');
  return buildBridgeRequest(input, 'moltfire-pokerclaw-test').publicHandContext;
}

// A scripted fake child process that mimics the spawn API enough for tests:
// stdout/stderr emit data, then 'close' fires with the configured exit code.
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill() { this.killed = true; }
}

type SpawnCall = {
  cmd: string;
  args: string[];
  opts: { shell?: boolean | string };
};

function makeFakeSpawn(scriptedStdout: string, exitCode = 0) {
  const calls: SpawnCall[] = [];
  const fn = (cmd: string, args: string[], opts: any) => {
    calls.push({ cmd, args, opts });
    const child = new FakeChild();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(scriptedStdout, 'utf8'));
      child.emit('close', exitCode);
    });
    return child as unknown as ChildProcess;
  };
  return { fn, calls };
}

describe('constructPrompt — privacy', () => {
  it('serializes only the public hand context; never opponent hole cards or deck state', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(1101) });
    const wesCardIds = s.players.wes.holeCards.map(cardId);
    applyAction(s, 'wes', { type: 'call' });
    const view = viewForPlayer(s, 'moltfire');
    const input = buildStrategyInput(view, 'match');
    const ctx = buildBridgeRequest(input, 'moltfire-pokerclaw').publicHandContext;
    const prompt = bridge.constructPrompt(ctx);
    for (const id of wesCardIds) {
      expect(prompt).not.toContain(id);
    }
    // The prompt itself must NOT include any internal deck/seed state.
    expect(prompt).not.toMatch(/deck/i);
    expect(prompt).not.toMatch(/seed/i);
    // Sanity: it must still include the legalActions block and the JSON-only directive.
    expect(prompt).toContain('legalActions');
    expect(prompt).toContain('Output JSON only');
  });
});

describe('extractActionFromReply — strict parsing', () => {
  it('accepts a clean { action, rationale } JSON object', () => {
    const out = bridge.extractActionFromReply(
      '{"action":{"type":"check"},"rationale":"pot control"}',
    );
    expect(out).not.toBeNull();
    expect(out.action).toEqual({ type: 'check' });
    expect(out.rationale).toBe('pot control');
  });

  it('accepts bet/raise with integer amount and normalizes shape', () => {
    const bet = bridge.extractActionFromReply(
      '{"action":{"type":"bet","amount":350},"rationale":"x"}',
    );
    expect(bet.action).toEqual({ type: 'bet', amount: 350 });
    const raise = bridge.extractActionFromReply(
      '{"action":{"type":"raise","amount":1100},"rationale":"x"}',
    );
    expect(raise.action).toEqual({ type: 'raise', amount: 1100 });
  });

  it('rejects malformed JSON', () => {
    expect(bridge.extractActionFromReply('not json')).toBeNull();
    expect(bridge.extractActionFromReply('{"action":')).toBeNull();
    expect(bridge.extractActionFromReply('')).toBeNull();
    expect(bridge.extractActionFromReply(null)).toBeNull();
  });

  it('rejects chain-of-thought before the JSON', () => {
    const reply = 'Let me think... I should bet here.\n{"action":{"type":"check"}}';
    expect(bridge.extractActionFromReply(reply)).toBeNull();
  });

  it('rejects chain-of-thought after the JSON', () => {
    const reply = '{"action":{"type":"check"}}\nThat was my reasoning.';
    expect(bridge.extractActionFromReply(reply)).toBeNull();
  });

  it('rejects an unknown action type', () => {
    expect(
      bridge.extractActionFromReply('{"action":{"type":"all-in"},"rationale":""}'),
    ).toBeNull();
  });

  it('rejects bet/raise with non-integer amount', () => {
    expect(
      bridge.extractActionFromReply('{"action":{"type":"bet","amount":200.5}}'),
    ).toBeNull();
    expect(
      bridge.extractActionFromReply('{"action":{"type":"bet","amount":"lots"}}'),
    ).toBeNull();
  });

  it('rejects arrays and primitives', () => {
    expect(bridge.extractActionFromReply('[{"action":{"type":"check"}}]')).toBeNull();
    expect(bridge.extractActionFromReply('"check"')).toBeNull();
  });
});

describe('resolveLiveConfig — env validation', () => {
  it('defaults agentId to moltfire-poker and cliPath to openclaw', () => {
    const cfg = bridge.resolveLiveConfig({});
    expect(cfg.agentId).toBe('moltfire-poker');
    expect(cfg.cliPath).toBe('openclaw');
    expect(cfg.timeoutSec).toBe(30);
  });

  it('rejects agentId=main even when explicitly set', () => {
    expect(() => bridge.resolveLiveConfig({ POKERCLAW_BRIDGE_LIVE_AGENT_ID: 'main' })).toThrow(
      /live-agent-id-banned/,
    );
    expect(() => bridge.resolveLiveConfig({ POKERCLAW_BRIDGE_LIVE_AGENT_ID: 'MAIN' })).toThrow(
      /live-agent-id-banned/,
    );
  });

  it('rejects other documented main-agent aliases', () => {
    for (const alias of ['default', 'primary', 'moltfire', 'moltfire-main']) {
      expect(() =>
        bridge.resolveLiveConfig({ POKERCLAW_BRIDGE_LIVE_AGENT_ID: alias }),
      ).toThrow(/live-agent-id-banned/);
    }
  });

  it('rejects an untrusted CLI path', () => {
    expect(() =>
      bridge.resolveLiveConfig({ POKERCLAW_BRIDGE_CLI_PATH: 'curl' }),
    ).toThrow(/live-cli-untrusted/);
    expect(() =>
      bridge.resolveLiveConfig({ POKERCLAW_BRIDGE_CLI_PATH: '../evil/openclaw' }),
    ).toThrow(/live-cli-untrusted/);
  });

  it('clamps timeoutSec to [1, 300]', () => {
    expect(
      bridge.resolveLiveConfig({ POKERCLAW_BRIDGE_LIVE_TIMEOUT_SEC: '0' }).timeoutSec,
    ).toBe(1);
    expect(
      bridge.resolveLiveConfig({ POKERCLAW_BRIDGE_LIVE_TIMEOUT_SEC: '99999' }).timeoutSec,
    ).toBe(300);
  });
});

describe('dispatchToOpenClaw — happy path', () => {
  beforeAll(() => bridge.__setResolveCliForTests((s: string) => s));
  afterAll(() => bridge.__resetResolveCliForTests());
  afterEach(() => bridge.__resetSpawnForTests());

  it('returns the parsed action when the CLI replies with strict JSON', async () => {
    const ctx = preflopCtx(1201);
    const envelope = JSON.stringify({
      reply: '{"action":{"type":"check"},"rationale":"ok"}',
    });
    const { fn, calls } = makeFakeSpawn(envelope, 0);
    bridge.__setSpawnForTests(fn);
    const result = await bridge.dispatchToOpenClaw(ctx, 'moltfire-pokerclaw');
    expect(result.action).toEqual({ type: 'check' });
    expect(result.rationale).toBe('ok');
    expect(result.agentId).toBe('moltfire-poker');
    // Spawn called without shell:true and with the expected argv shape.
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('openclaw');
    expect(calls[0].opts.shell).toBe(false);
    expect(calls[0].args).toContain('--agent');
    expect(calls[0].args).toContain('moltfire-poker');
    expect(calls[0].args).toContain('--session-id');
    expect(calls[0].args).toContain('moltfire-pokerclaw');
    expect(calls[0].args).toContain('--json');
    expect(calls[0].args).toContain('--timeout');
  });

  it('parses OpenClaw-style { result: { payloads: [{ text }] } } envelopes', async () => {
    const ctx = preflopCtx(1203);
    const envelope = JSON.stringify({
      runId: 'r',
      status: 'ok',
      result: {
        payloads: [{ text: '{"action":{"type":"check"},"rationale":"ok"}', mediaUrl: null }],
        meta: {},
      },
    });
    const { fn } = makeFakeSpawn(envelope, 0);
    bridge.__setSpawnForTests(fn);
    const result = await bridge.dispatchToOpenClaw(ctx, 'moltfire-pokerclaw');
    expect(result.action).toEqual({ type: 'check' });
  });

  it('parses Anthropic-style content[] envelopes', async () => {
    const ctx = preflopCtx(1202);
    const envelope = JSON.stringify({
      content: [{ type: 'text', text: '{"action":{"type":"check"},"rationale":"v"}' }],
    });
    const { fn } = makeFakeSpawn(envelope, 0);
    bridge.__setSpawnForTests(fn);
    const result = await bridge.dispatchToOpenClaw(ctx, 'moltfire-pokerclaw');
    expect(result.action).toEqual({ type: 'check' });
  });
});

describe('dispatchToOpenClaw — refusals and failures', () => {
  beforeAll(() => bridge.__setResolveCliForTests((s: string) => s));
  afterAll(() => bridge.__resetResolveCliForTests());
  afterEach(() => bridge.__resetSpawnForTests());

  it('refuses an empty session label', async () => {
    const ctx = preflopCtx(1301);
    await expect(bridge.dispatchToOpenClaw(ctx, '')).rejects.toThrow(/session-label-empty/);
    await expect(bridge.dispatchToOpenClaw(ctx, '   ')).rejects.toThrow(/session-label-empty/);
  });

  it('refuses to spawn when agentId=main is configured', async () => {
    const ctx = preflopCtx(1302);
    await expect(
      bridge.dispatchToOpenClaw(ctx, 'moltfire-pokerclaw', {
        env: { POKERCLAW_BRIDGE_LIVE_AGENT_ID: 'main' },
      }),
    ).rejects.toThrow(/live-agent-id-banned/);
  });

  it('throws on a non-zero CLI exit', async () => {
    const ctx = preflopCtx(1303);
    const { fn } = makeFakeSpawn('', 1);
    bridge.__setSpawnForTests(fn);
    await expect(bridge.dispatchToOpenClaw(ctx, 'moltfire-pokerclaw')).rejects.toThrow(
      /cli-exit-1/,
    );
  });

  it('throws on a malformed CLI envelope', async () => {
    const ctx = preflopCtx(1304);
    const { fn } = makeFakeSpawn('this is not json', 0);
    bridge.__setSpawnForTests(fn);
    await expect(bridge.dispatchToOpenClaw(ctx, 'moltfire-pokerclaw')).rejects.toThrow(
      /cli-envelope-malformed/,
    );
  });

  it('throws on a reply that smuggles chain-of-thought', async () => {
    const ctx = preflopCtx(1305);
    const reply =
      'Thinking out loud about pot odds...\n{"action":{"type":"check"},"rationale":"x"}';
    const { fn } = makeFakeSpawn(JSON.stringify({ reply }), 0);
    bridge.__setSpawnForTests(fn);
    await expect(bridge.dispatchToOpenClaw(ctx, 'moltfire-pokerclaw')).rejects.toThrow(
      /not-strict-json/,
    );
  });

  it('throws when the CLI proposes an illegal action for the spot', async () => {
    // Preflop after Wes's limp: BB check is legal, bet is NOT (currentBet > 0).
    const ctx = preflopCtx(1306);
    const reply = '{"action":{"type":"bet","amount":500},"rationale":"x"}';
    const { fn } = makeFakeSpawn(JSON.stringify({ reply }), 0);
    bridge.__setSpawnForTests(fn);
    await expect(bridge.dispatchToOpenClaw(ctx, 'moltfire-pokerclaw')).rejects.toThrow(
      /cli-action-illegal/,
    );
  });

  it('caps the outbound CLI message to 8 KB', async () => {
    const ctx = preflopCtx(1307);
    // Stuff a giant history entry into ctx to overflow the prompt cap.
    const huge = 'x'.repeat(10 * 1024);
    (ctx as any).actionHistory = [{ huge }];
    const { fn } = makeFakeSpawn(JSON.stringify({ reply: '{}' }), 0);
    bridge.__setSpawnForTests(fn);
    await expect(bridge.dispatchToOpenClaw(ctx, 'moltfire-pokerclaw')).rejects.toThrow(
      /message-too-large/,
    );
  });
});

// -----------------------------------------------------------------------
// HTTP-level integration: spawn the real sidecar with a fake CLI and confirm
// /decide returns 502 when the live dispatch path fails, and that the bridge
// never logs hole-card strings.
// -----------------------------------------------------------------------

describe('sidecar /decide — 502 on dispatch failure (live mode)', () => {
  let child: ChildProcess | null = null;
  let port = 0;
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  beforeEach(async () => {
    port = 5400 + Math.floor(Math.random() * 200);
    stdoutLines.length = 0;
    stderrLines.length = 0;
    const sidecarPath = path.resolve(
      fileURLToPath(new URL('../bridge/moltfire-bridge.mjs', import.meta.url)),
    );
    // Run in LIVE mode (no --dry-run), but point the CLI at a binary that
    // does not exist — dispatch should throw and HTTP must respond 502.
    child = spawn(process.execPath, [sidecarPath], {
      env: {
        ...process.env,
        POKERCLAW_BRIDGE_PORT: String(port),
        POKERCLAW_AGENT_BRIDGE_SESSION_LABEL: 'moltfire-pokerclaw-test',
        POKERCLAW_BRIDGE_LIVE_AGENT_ID: 'moltfire-poker',
        // Force spawn failure by pointing at a binary that does not exist.
        // The cliPath must still pass the trust check — use an absolute path.
        POKERCLAW_BRIDGE_CLI_PATH:
          process.platform === 'win32'
            ? 'C:\\does\\not\\exist\\openclaw.exe'
            : '/does/not/exist/openclaw',
        POKERCLAW_BRIDGE_LIVE_TIMEOUT_SEC: '2',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (b) => stdoutLines.push(b.toString('utf8')));
    child.stderr?.on('data', (b) => stderrLines.push(b.toString('utf8')));
    await waitForHealth(`http://127.0.0.1:${port}/health`, 5000);
  });

  afterEach(async () => {
    if (child && !child.killed) {
      child.kill('SIGINT');
      await new Promise<void>((resolve) => {
        if (!child) return resolve();
        child.once('exit', () => resolve());
        setTimeout(() => {
          if (child && !child.killed) child.kill();
          resolve();
        }, 1500);
      });
      child = null;
    }
  });

  it('returns 502 when the live CLI cannot be spawned', async () => {
    const ctx = preflopCtx(1401);
    const body = JSON.stringify({ publicHandContext: ctx });
    const res = await fetch(`http://127.0.0.1:${port}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(res.status).toBe(502);
  });

  it('never prints hole-card strings to stdout or stderr', async () => {
    // Pick a fixed seed so we know exactly which hole cards MoltFire holds.
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(1501) });
    const moltCardIds = s.players.moltfire.holeCards.map(cardId);
    applyAction(s, 'wes', { type: 'call' });
    const view = viewForPlayer(s, 'moltfire');
    const input = buildStrategyInput(view, 'match');
    const ctx = buildBridgeRequest(input, 'moltfire-pokerclaw-test').publicHandContext;
    const body = JSON.stringify({ publicHandContext: ctx });
    await fetch(`http://127.0.0.1:${port}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    // Wait briefly so logs flush.
    await new Promise((r) => setTimeout(r, 200));
    const stdoutBlob = stdoutLines.join('');
    const stderrBlob = stderrLines.join('');
    for (const id of moltCardIds) {
      expect(stdoutBlob).not.toContain(id);
      expect(stderrBlob).not.toContain(id);
    }
  });
});

// -----------------------------------------------------------------------
// HTTP-level integration: confirm dry-run mode still works post-refactor.
// -----------------------------------------------------------------------

describe('sidecar /decide — dry-run mode still works after live refactor', () => {
  let child: ChildProcess | null = null;
  let port = 0;

  beforeEach(async () => {
    port = 5600 + Math.floor(Math.random() * 200);
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
        setTimeout(() => {
          if (child && !child.killed) child.kill();
          resolve();
        }, 1500);
      });
      child = null;
    }
  });

  it('responds 200 with a legal action via /decide', async () => {
    const ctx = preflopCtx(1601);
    const res = await fetch(`http://127.0.0.1:${port}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicHandContext: ctx }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { action: { type: string } };
    // Preflop, BB option after Wes's limp: dry-run returns check.
    expect(body.action.type).toBe('check');
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
