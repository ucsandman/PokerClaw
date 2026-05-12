import type {
  FastLiveConfig,
  Strategy,
  StrategyDecision,
  StrategyInput,
} from '../types';
import { SYSTEM_PROMPT, buildUserPrompt } from './llm/prompt';
import { parseDecisionJson } from './llm/parse';
import { coerceAction } from './llm/coerce';
import { callAnthropic } from './llm/anthropic';
import { callOpenAICompatible } from './llm/openai';

// Repair instructions appended on the retry attempt. We keep the public
// rationale guidance from SYSTEM_PROMPT and just remind the model that the
// previous output was unparseable.
const REPAIR_NOTE =
  'Your previous reply was not valid JSON or was not legal for the current spot. ' +
  'Respond NOW with a single JSON object only. No prose. No code fences. ' +
  'Choose exactly one of the legal actions. Use the rationale field for a short ' +
  'public-safe note like "position and price".';

// Fast direct-model strategy. Calls the configured provider once, validates
// the reply against legalActions, and retries with a repair prompt up to
// cfg.maxRetries times before declining. Returns `null` on:
//   - empty/invalid JSON after all retries
//   - illegal action after all retries
//   - network/timeout error
//
// The strategy NEVER throws — the runner's chain falls through to rules on
// `null`.
export function makeFastLiveStrategy(cfg: FastLiveConfig): Strategy {
  return {
    name: 'fast-live',
    async decide(input: StrategyInput): Promise<StrategyDecision> {
      const baseUser = buildUserPrompt(input);
      for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
        const user = attempt === 0 ? baseUser : `${baseUser}\n\n${REPAIR_NOTE}`;
        try {
          const text = await callProvider(cfg, SYSTEM_PROMPT, user);
          const parsed = parseDecisionJson(text);
          if (!parsed) continue;
          const action = coerceAction(parsed.action, input.legalActions);
          if (!action) continue;
          return {
            action,
            rationale: parsed.rationale ?? 'fast-live',
            tableTalk: parsed.tableTalk,
          };
        } catch {
          // Network/timeout/etc — try once more if retries remain, then bail.
          continue;
        }
      }
      return null;
    },
  };
}

async function callProvider(
  cfg: FastLiveConfig,
  system: string,
  user: string,
): Promise<string> {
  // Reuse the existing provider call helpers. They share the same surface as
  // LLMConfig (provider, apiUrl, apiKey, model, timeoutMs) so we pass a
  // structurally-compatible object — fast-live just enforces a tighter
  // timeout and a separate model id.
  const llmShape = {
    provider: cfg.provider,
    apiUrl: cfg.apiUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    timeoutMs: cfg.timeoutMs,
  };
  return cfg.provider === 'anthropic'
    ? callAnthropic(llmShape, system, user)
    : callOpenAICompatible(llmShape, system, user);
}
