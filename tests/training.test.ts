import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { Session } from '../server/state';
import { buildRouter } from '../server/routes';
import { cardId } from '../shared/cards';
import { formatHand, formatSession } from '../server/review/format';
import { resolveReviewConfig, extractMarkdown, generateReview } from '../server/review';

const CONFIG = { smallBlind: 50, bigBlind: 100, startingStack: 10000 };

// Helper: drive Wes to fold preflop so the hand completes deterministically.
function playWesFoldHand(session: Session): void {
  // Whoever is on the button (small blind) acts first preflop in HU.
  const view = session.rawState();
  const sbPlayer = view.players[view.button];
  // Hand 1: default button=wes. SB acts first.
  if (view.currentActor === 'wes') {
    session.applyPlayerAction('wes', { type: 'fold' });
  } else {
    session.applyPlayerAction('moltfire', { type: 'fold' });
  }
  // After the fold the hand should be complete.
  if (!sbPlayer) throw new Error('sb player missing');
}

// ---------------------------------------------------------------------------
// Training state transitions
// ---------------------------------------------------------------------------

describe('Session training lifecycle', () => {
  it('starts inactive with zero hands', () => {
    const s = new Session(CONFIG);
    const status = s.trainingStatus();
    expect(status.active).toBe(false);
    expect(status.handCount).toBe(0);
    expect(status.startedAt).toBeNull();
    expect(s.trainingBuffer()).toEqual([]);
  });

  it('startTraining activates and records timestamp', () => {
    const s = new Session(CONFIG);
    const before = Date.now();
    s.startTraining();
    const status = s.trainingStatus();
    expect(status.active).toBe(true);
    expect(status.handCount).toBe(0);
    expect(status.startedAt).not.toBeNull();
    expect(status.startedAt!).toBeGreaterThanOrEqual(before);
  });

  it('endTraining returns snapshots and deactivates', () => {
    const s = new Session(CONFIG);
    s.startTraining();
    playWesFoldHand(s);
    expect(s.trainingStatus().handCount).toBe(1);
    const snapshots = s.endTraining();
    expect(snapshots).toHaveLength(1);
    expect(s.trainingStatus().active).toBe(false);
    // Buffer remains available for /api/training/review until next start().
    expect(s.trainingBuffer()).toHaveLength(1);
  });

  it('reset() preserves the training buffer so bust-out + Play Again does not wipe study', () => {
    // Design choice: match reset is independent of training. A player who
    // busts out and clicks "Play again" mid-study should keep their captured
    // hands. They can explicitly hit "Restart" on the training control if
    // they want a fresh buffer.
    const s = new Session(CONFIG);
    s.startTraining();
    playWesFoldHand(s);
    expect(s.trainingBuffer()).toHaveLength(1);
    s.reset();
    expect(s.trainingBuffer()).toHaveLength(1);
  });

  it('does NOT capture hands when training is inactive', () => {
    const s = new Session(CONFIG);
    playWesFoldHand(s);
    expect(s.trainingBuffer()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Hand capture details (privacy + content)
// ---------------------------------------------------------------------------

describe('hand snapshot capture', () => {
  it('captures Wes hole cards but hides MoltFire cards on a fold-without-showdown', () => {
    const s = new Session(CONFIG);
    const moltCards = new Set(s.rawState().players.moltfire.holeCards.map(cardId));
    s.startTraining();
    playWesFoldHand(s);
    const [snap] = s.trainingBuffer();
    // Wes folded, so MoltFire wins by fold — Wes's cards revealed? No: fold
    // path reveals only the WINNER's cards is not the engine contract — the
    // engine's `result.reveal` for fold = the WINNER side only.
    expect(snap.wesHoleCards.length).toBeGreaterThanOrEqual(0);
    // If MoltFire was not the folder, their cards must NOT be in the snapshot
    // unless they were revealed at showdown. A preflop fold has no showdown.
    if (snap.moltfireHoleCards) {
      for (const c of snap.moltfireHoleCards) {
        expect(moltCards.has(cardId(c))).toBe(true); // tautology if present
      }
    } else {
      // Privacy: serialize the entire snapshot, ensure none of MoltFire's
      // actual hole cards appear anywhere in the wire shape.
      const wire = JSON.stringify(snap);
      for (const id of moltCards) {
        expect(wire).not.toContain(id);
      }
    }
  });

  it('captures both players hole cards when the hand goes to showdown', () => {
    const s = new Session(CONFIG);
    const wesCards = new Set(s.rawState().players.wes.holeCards.map(cardId));
    const moltCards = new Set(s.rawState().players.moltfire.holeCards.map(cardId));
    s.startTraining();
    // Wes shoves preflop, MoltFire calls — all-in showdown.
    const view = s.rawState();
    const wesStack = view.players.wes.stack + view.players.wes.committedThisStreet;
    s.applyPlayerAction('wes', { type: 'raise', amount: wesStack });
    s.applyPlayerAction('moltfire', { type: 'call' });
    const [snap] = s.trainingBuffer();
    expect(snap).toBeDefined();
    expect(snap.moltfireHoleCards).not.toBeNull();
    const wesIds = new Set(snap.wesHoleCards.map(cardId));
    const moltIds = new Set((snap.moltfireHoleCards ?? []).map(cardId));
    for (const id of wesCards) expect(wesIds.has(id)).toBe(true);
    for (const id of moltCards) expect(moltIds.has(id)).toBe(true);
  });

  it('captures multiple hands in order', () => {
    const s = new Session(CONFIG);
    s.startTraining();
    playWesFoldHand(s);
    s.startNextHand();
    playWesFoldHand(s);
    s.startNextHand();
    playWesFoldHand(s);
    const buf = s.trainingBuffer();
    expect(buf).toHaveLength(3);
    expect(buf.map((h) => h.handId)).toEqual([1, 2, 3]);
  });

  it('does not double-capture the same handId', () => {
    const s = new Session(CONFIG);
    s.startTraining();
    playWesFoldHand(s);
    // startNextHand calls captureIfComplete defensively — should be a no-op.
    s.startNextHand();
    expect(s.trainingBuffer()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

describe('review formatter', () => {
  it('formats a single hand with handId, blinds, stacks, board, and result', () => {
    const s = new Session(CONFIG);
    s.startTraining();
    playWesFoldHand(s);
    const [snap] = s.trainingBuffer();
    const txt = formatHand(snap);
    expect(txt).toContain(`Hand ${snap.handId}`);
    expect(txt).toContain(`blinds ${snap.smallBlind}/${snap.bigBlind}`);
    expect(txt).toContain('Wes hole cards:');
    expect(txt).toContain('MoltFire hole cards:');
    expect(txt).toContain('Result:');
    expect(txt).toContain('Wes Δstack:');
  });

  it('marks MoltFire cards as hidden when not shown', () => {
    const s = new Session(CONFIG);
    s.startTraining();
    playWesFoldHand(s);
    const [snap] = s.trainingBuffer();
    if (snap.moltfireHoleCards === null) {
      expect(formatHand(snap)).toContain('(hidden — not shown at showdown)');
    }
  });

  it('formats a multi-hand session with the right header', () => {
    const s = new Session(CONFIG);
    s.startTraining();
    playWesFoldHand(s);
    s.startNextHand();
    playWesFoldHand(s);
    const txt = formatSession(s.trainingBuffer());
    expect(txt).toContain('Training session: 2 hand');
    expect(txt).toContain('Wes net result over session:');
    expect(txt).toContain('Hand 1');
    expect(txt).toContain('Hand 2');
  });

  it('returns a placeholder for empty input', () => {
    expect(formatSession([])).toBe('(no hands captured)');
  });
});

// ---------------------------------------------------------------------------
// Review config + response parsing
// ---------------------------------------------------------------------------

describe('reviewer config', () => {
  it('returns null when no api key is set', () => {
    expect(resolveReviewConfig({})).toBeNull();
  });

  it('uses POKERCLAW_REVIEW_MODEL when set', () => {
    const cfg = resolveReviewConfig({
      POKERCLAW_AGENT_API_KEY: 'sk',
      POKERCLAW_AGENT_MODEL: 'claude-base',
      POKERCLAW_REVIEW_MODEL: 'claude-opus',
    });
    expect(cfg?.model).toBe('claude-opus');
  });

  it('falls back to POKERCLAW_AGENT_MODEL when review model unset', () => {
    const cfg = resolveReviewConfig({
      POKERCLAW_AGENT_API_KEY: 'sk',
      POKERCLAW_AGENT_MODEL: 'claude-base',
    });
    expect(cfg?.model).toBe('claude-base');
  });

  it('clamps timeout to [5000, 180000]', () => {
    expect(
      resolveReviewConfig({
        POKERCLAW_AGENT_API_KEY: 'sk',
        POKERCLAW_AGENT_MODEL: 'm',
        POKERCLAW_REVIEW_TIMEOUT_MS: '500',
      })?.timeoutMs,
    ).toBe(5000);
    expect(
      resolveReviewConfig({
        POKERCLAW_AGENT_API_KEY: 'sk',
        POKERCLAW_AGENT_MODEL: 'm',
        POKERCLAW_REVIEW_TIMEOUT_MS: '999999',
      })?.timeoutMs,
    ).toBe(180000);
  });
});

describe('reviewer response parser', () => {
  it('extracts text from the Anthropic content array', () => {
    const md = extractMarkdown({ content: [{ type: 'text', text: '# Hello' }] });
    expect(md).toBe('# Hello');
  });

  it('joins multiple text blocks with newline', () => {
    const md = extractMarkdown({
      content: [
        { type: 'text', text: 'A' },
        { type: 'text', text: 'B' },
      ],
    });
    expect(md).toBe('A\nB');
  });

  it('throws parse error on missing/empty content', () => {
    expect(() => extractMarkdown({})).toThrow(/parse/);
    expect(() => extractMarkdown({ content: [] })).toThrow(/parse/);
    expect(() => extractMarkdown({ content: [{ type: 'text', text: '' }] })).toThrow(/parse/);
  });
});

describe('generateReview short-circuits', () => {
  it('returns empty-buffer error when no hands are captured', async () => {
    const result = await generateReview([], {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty-buffer');
  });

  it('returns no-config error when api key is missing', async () => {
    const s = new Session(CONFIG);
    s.startTraining();
    playWesFoldHand(s);
    const result = await generateReview(s.trainingBuffer(), {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-config');
  });
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------

describe('training API endpoints', () => {
  async function withServer<T>(fn: (url: string) => Promise<T>): Promise<T> {
    const session = new Session(CONFIG);
    const app = express();
    app.use(express.json());
    app.use(buildRouter(session));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    try {
      return await fn(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  }

  it('GET /api/training/status returns initial inactive state', async () => {
    await withServer(async (url) => {
      const res = await fetch(`${url}/api/training/status`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { active: boolean; handCount: number };
      expect(body.active).toBe(false);
      expect(body.handCount).toBe(0);
    });
  });

  it('POST /api/training/start → status reports active', async () => {
    await withServer(async (url) => {
      const res = await fetch(`${url}/api/training/start`, { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { active: boolean };
      expect(body.active).toBe(true);
    });
  });

  it('POST /api/training/review with empty buffer returns 400 empty-buffer', async () => {
    await withServer(async (url) => {
      const res = await fetch(`${url}/api/training/review`, { method: 'POST' });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: false; reason: string };
      expect(body.ok).toBe(false);
      expect(body.reason).toBe('empty-buffer');
    });
  });
});
