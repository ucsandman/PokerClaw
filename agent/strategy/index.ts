import type { AgentConfig, Strategy, StrategyDecision, StrategyInput } from '../types';
import { ruleStrategy } from './rules';
import { safeFallbackStrategy } from './safe';
import { makeLLMStrategy } from './llm';
import { makeBridgeStrategy } from './openclaw-bridge';
import { makeFastLiveStrategy } from './fast-live';
import { ruleShortcutStrategy } from './rule-shortcut';

// Builds the agent's strategy chain. The first to return a non-null decision
// wins.
//
// Chain shape is driven by `cfg.strategy`:
//
//   fast-live (default, playable):
//     1. rules-shortcut (only fires on free-check, low-pressure spots)
//     2. fast-live (direct model call, <=5s timeout, 1 repair retry)
//     3. rules (deterministic toy bot)
//     4. safe-fallback (check → cheap call → fold)
//
//   openclaw-bridge (review / tank / identity mode):
//     1. openclaw-bridge (full OpenClaw CLI agent turn)
//     2. fast-live (if configured) for fallback
//     3. rules
//     4. safe-fallback
//
//   rules (no-model, deterministic):
//     1. rules
//     2. safe-fallback
//
// When `cfg.disableFallback` is true the chain collapses to ONLY the primary
// strategy for the active mode. This is how launcher verification proves the
// primary path actually produced the action — fallbacks can't hide a broken
// primary.
export function buildStrategyChain(cfg: AgentConfig): Strategy[] {
  // Same fall-through as loadAgentConfig: explicit cfg.strategy wins, then
  // bridge presence (back-compat for older operator setups), then fast-live.
  const strategy = cfg.strategy ?? (cfg.bridge ? 'openclaw-bridge' : 'fast-live');

  if (cfg.disableFallback) {
    if (strategy === 'openclaw-bridge' && cfg.bridge) {
      return [makeBridgeStrategy(cfg.bridge)];
    }
    if (strategy === 'fast-live' && cfg.fastLive) {
      return [makeFastLiveStrategy(cfg.fastLive)];
    }
    // strategy=rules has nothing to disable — rules always produces.
  }

  if (strategy === 'rules') {
    return [ruleStrategy, safeFallbackStrategy];
  }

  if (strategy === 'openclaw-bridge') {
    const chain: Strategy[] = [];
    if (cfg.bridge) chain.push(makeBridgeStrategy(cfg.bridge));
    if (cfg.fastLive) chain.push(makeFastLiveStrategy(cfg.fastLive));
    else if (cfg.llm) chain.push(makeLLMStrategy(cfg.llm));
    chain.push(ruleStrategy);
    chain.push(safeFallbackStrategy);
    return chain;
  }

  // strategy === 'fast-live'
  const chain: Strategy[] = [];
  if (cfg.ruleShortcutsEnabled !== false) chain.push(ruleShortcutStrategy);
  if (cfg.fastLive) chain.push(makeFastLiveStrategy(cfg.fastLive));
  else if (cfg.llm) chain.push(makeLLMStrategy(cfg.llm));
  chain.push(ruleStrategy);
  chain.push(safeFallbackStrategy);
  return chain;
}

export async function decideViaChain(
  chain: Strategy[],
  input: StrategyInput,
): Promise<{ decision: StrategyDecision; strategy: string }> {
  for (const s of chain) {
    const d = await s.decide(input);
    if (d) return { decision: d, strategy: s.name };
  }
  return { decision: null, strategy: 'none' };
}
