import { Router, type Request, type Response } from 'express';
import type { PlayerAction, PlayerId } from '../shared/types';
import { viewForPlayer, type AgentStatus } from '../shared/view-models';
import type { Session } from './state';
import { generateReview } from './review';

// Builds the API router. The router only ever returns scrubbed views via
// viewForPlayer — full GameState is never serialized to the wire.
export function buildRouter(session: Session): Router {
  const router = Router();

  router.get('/api/player/wes/state', (_req, res) => {
    res.json(
      viewForPlayer(session.rawState(), 'wes', {
        agentStatus: session.getAgentStatus(),
        training: session.trainingStatus(),
      }),
    );
  });

  router.post('/api/player/wes/action', (req, res) => {
    handleAction(session, 'wes', req, res);
  });

  router.get('/api/ai/state', (_req, res) => {
    res.json(
      viewForPlayer(session.rawState(), 'moltfire', {
        agentStatus: session.getAgentStatus(),
        training: session.trainingStatus(),
      }),
    );
  });

  router.post('/api/ai/action', (req, res) => {
    handleAction(session, 'moltfire', req, res);
  });

  router.post('/api/new-hand', (_req, res) => {
    try {
      session.startNextHand();
    } catch (err) {
      return res.status(400).json({ error: errorMessage(err) });
    }
    res.json({ ok: true });
  });

  router.post('/api/reset', (_req, res) => {
    session.reset();
    res.json({ ok: true });
  });

  // Heartbeat endpoint used by the local agent. Records what strategy/mode
  // is currently driving MoltFire so the UI can display "LLM mode" /
  // "Agent offline" without polling the agent process directly.
  router.post('/api/agent/status', (req, res) => {
    const status = parseAgentStatus(req.body);
    if (!status) {
      return res.status(400).json({ error: 'Invalid agent status payload.' });
    }
    session.recordAgentHeartbeat(status);
    res.json({ ok: true });
  });

  router.get('/api/agent/status', (_req, res) => {
    res.json(session.getAgentStatus() ?? { connected: false });
  });

  // ---- Training session --------------------------------------------------
  // Wes turns on training, plays a batch of hands, turns it off, then asks
  // for a review. The review call is non-interactive and may take 30-60s.

  router.get('/api/training/status', (_req, res) => {
    res.json(session.trainingStatus());
  });

  router.post('/api/training/start', (_req, res) => {
    session.startTraining();
    res.json(session.trainingStatus());
  });

  router.post('/api/training/end', (_req, res) => {
    const snapshots = session.endTraining();
    res.json({ ...session.trainingStatus(), handCount: snapshots.length });
  });

  router.post('/api/training/review', async (_req, res) => {
    const hands = session.trainingBuffer();
    const result = await generateReview(hands, process.env);
    if (!result.ok) {
      const status =
        result.reason === 'empty-buffer'
          ? 400
          : result.reason === 'no-config'
          ? 503
          : result.reason === 'timeout'
          ? 504
          : 502;
      return res.status(status).json({ ok: false, reason: result.reason, error: result.message });
    }
    res.json({
      ok: true,
      markdown: result.markdown,
      handCount: result.handCount,
      model: result.model,
      latencyMs: result.latencyMs,
    });
  });

  // Optional full-state debug endpoint. OFF unless explicitly enabled.
  if (process.env.POKERCLAW_DEBUG_FULL_STATE === '1') {
    router.get('/api/debug/full-state', (_req, res) => {
      res.json(session.rawState());
    });
  }

  return router;
}

function handleAction(
  session: Session,
  playerId: PlayerId,
  req: Request,
  res: Response,
): void {
  const action = parseAction(req.body);
  if (!action) {
    res.status(400).json({ error: 'Invalid action payload.' });
    return;
  }
  try {
    session.applyPlayerAction(playerId, action);
  } catch (err) {
    res.status(400).json({ error: errorMessage(err) });
    return;
  }
  res.json(
    viewForPlayer(session.rawState(), playerId, {
      agentStatus: session.getAgentStatus(),
      training: session.trainingStatus(),
    }),
  );
}

function parseAction(body: unknown): PlayerAction | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  switch (b.type) {
    case 'fold':
    case 'check':
    case 'call':
      return { type: b.type };
    case 'bet':
    case 'raise': {
      const amount = Number(b.amount);
      if (!Number.isFinite(amount)) return null;
      return { type: b.type, amount: Math.trunc(amount) };
    }
    default:
      return null;
  }
}

function parseAgentStatus(body: unknown): AgentStatus | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const strategy = b.strategy;
  if (
    strategy !== 'fast-live' &&
    strategy !== 'openclaw-bridge' &&
    strategy !== 'llm' &&
    strategy !== 'rules' &&
    strategy !== 'unknown'
  ) {
    return null;
  }
  const mode = b.mode;
  if (mode !== 'match' && mode !== 'training' && mode !== 'debug') return null;
  const provider =
    b.provider === 'anthropic' || b.provider === 'openai-compatible' ? b.provider : undefined;
  const model = typeof b.model === 'string' ? b.model : undefined;
  const sessionLabel = typeof b.sessionLabel === 'string' ? b.sessionLabel : undefined;
  return {
    connected: true,
    strategy,
    provider,
    model,
    sessionLabel,
    mode,
    lastHeartbeat: new Date().toISOString(),
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}
