// Load .env from the project root before any module-level process.env reads.
// dotenv does NOT override variables already set in the real environment.
import 'dotenv/config';
import { AgentClient } from './client';
import { loadAgentConfig, describeStartup } from './config';
import { buildStrategyChain } from './strategy';
import { logDecision, logError, logInfo } from './log';
import { AgentRunner } from './runner';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const enabled = (process.env.POKERCLAW_AGENT_ENABLED ?? 'true').toLowerCase() === 'true';
if (!enabled) {
  logInfo('POKERCLAW_AGENT_ENABLED=false — exiting without acting.');
  process.exit(0);
}

const cfg = loadAgentConfig(process.env, process.argv);
const client = new AgentClient(cfg.serverUrl);
const chain = buildStrategyChain(cfg);

logInfo(describeStartup(cfg));

const statusPayload = {
  strategy: cfg.strategy as 'fast-live' | 'openclaw-bridge' | 'rules' | 'llm',
  provider: cfg.fastLive?.provider ?? cfg.llm?.provider,
  model: cfg.fastLive?.model ?? cfg.llm?.model,
  mode: cfg.mode,
  sessionLabel: cfg.bridge?.sessionLabel,
};

// Fire an immediate heartbeat so the UI flips to "connected" as soon as
// the agent starts.
client.postStatus(statusPayload).catch(() => undefined);

const runner = new AgentRunner({
  client,
  chain,
  mode: cfg.mode,
  dryRun: cfg.dryRun,
  log: { decision: logDecision, error: logError },
});

let stopped = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sequential loop: only one tick runs at a time. If a decision (LLM call) takes
// longer than cfg.pollMs we just resume immediately on the next iteration —
// we never stack overlapping ticks (which was the source of the duplicate
// stale-action posts described in AGENT_RACE_BUGFIX.md).
async function runLoop(): Promise<void> {
  while (!stopped) {
    client.postStatus(statusPayload).catch(() => undefined);
    const started = Date.now();
    try {
      await runner.tick();
    } catch (err) {
      logError(err);
    }
    const elapsed = Date.now() - started;
    const wait = Math.max(0, cfg.pollMs - elapsed);
    if (wait > 0) await sleep(wait);
  }
}

runLoop().catch(logError);

process.on('SIGINT', () => {
  stopped = true;
  logInfo('agent stopped');
  process.exit(0);
});
