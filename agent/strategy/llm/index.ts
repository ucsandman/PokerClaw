import type { LLMConfig, Strategy, StrategyDecision, StrategyInput } from '../../types';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt';
import { parseDecisionJson } from './parse';
import { coerceAction } from './coerce';
import { callAnthropic } from './anthropic';
import { callOpenAICompatible } from './openai';

// Builds a Strategy that calls the configured provider, parses its JSON
// response, validates the action against legalActions, and returns the
// resulting decision. Any failure (network/timeout/parse/illegal) returns
// `null` so the chain falls through to the rule strategy.
export function makeLLMStrategy(cfg: LLMConfig): Strategy {
  return {
    name: `llm:${cfg.provider}`,
    async decide(input: StrategyInput): Promise<StrategyDecision> {
      try {
        const user = buildUserPrompt(input);
        const text =
          cfg.provider === 'anthropic'
            ? await callAnthropic(cfg, SYSTEM_PROMPT, user)
            : await callOpenAICompatible(cfg, SYSTEM_PROMPT, user);
        const parsed = parseDecisionJson(text);
        if (!parsed) return null;
        const action = coerceAction(parsed.action, input.legalActions);
        if (!action) return null;
        return {
          action,
          rationale: parsed.rationale ?? cfg.provider,
          tableTalk: parsed.tableTalk,
        };
      } catch {
        return null;
      }
    },
  };
}

// Re-exports used by tests and the agent entry.
export { SYSTEM_PROMPT, buildUserPrompt } from './prompt';
export { parseDecisionJson, extractAnthropicText, extractOpenAIText } from './parse';
export { coerceAction } from './coerce';
