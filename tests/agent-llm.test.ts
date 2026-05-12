import { describe, it, expect } from 'vitest';
import {
  buildUserPrompt,
  parseDecisionJson,
  coerceAction,
  extractAnthropicText,
  extractOpenAIText,
} from '../agent/strategy/llm';
import { buildStrategyInput } from '../agent/strategy-input';
import { startSession, applyAction } from '../shared/game';
import { viewForPlayer } from '../shared/view-models';
import { cardId } from '../shared/cards';
import { seededRand } from './seeded-rand';
import type { StrategyInput } from '../agent/types';

const CONFIG = { smallBlind: 50, bigBlind: 100, startingStack: 10000 };

function preflopInput(seed: number): StrategyInput {
  const s = startSession(CONFIG, { button: 'wes', rand: seededRand(seed) });
  applyAction(s, 'wes', { type: 'call' });
  const view = viewForPlayer(s, 'moltfire');
  return buildStrategyInput(view, 'match');
}

describe('LLM prompt builder', () => {
  it('renders the authorized state including legal actions', () => {
    const input = preflopInput(501);
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain(`Street: ${input.street}`);
    expect(prompt).toContain(`Pot: ${input.pot}`);
    expect(prompt).toContain(`Big blind: ${input.bigBlind}`);
    expect(prompt).toContain('Legal actions:');
  });

  it('includes the public action history', () => {
    const input = preflopInput(502);
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain('Public action history');
    // Wes already limped preflop in preflopInput, so the history should show it.
    expect(prompt).toContain('[preflop]');
    expect(prompt).toMatch(/Wes calls/);
  });

  it('never includes opponent hole cards', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(503) });
    const wesCardIds = s.players.wes.holeCards.map(cardId);
    applyAction(s, 'wes', { type: 'call' });
    const input = buildStrategyInput(viewForPlayer(s, 'moltfire'), 'match');
    const prompt = buildUserPrompt(input);
    for (const id of wesCardIds) {
      expect(prompt).not.toContain(id);
    }
  });

  it('includes my hole cards (agent needs them to play)', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(504) });
    const moltCardIds = s.players.moltfire.holeCards.map(cardId);
    applyAction(s, 'wes', { type: 'call' });
    const input = buildStrategyInput(viewForPlayer(s, 'moltfire'), 'match');
    const prompt = buildUserPrompt(input);
    for (const id of moltCardIds) {
      expect(prompt).toContain(id);
    }
  });
});

describe('LLM response parsing', () => {
  it('parses strict JSON action', () => {
    const parsed = parseDecisionJson('{"action":{"type":"call"},"rationale":"limp call"}');
    expect(parsed).toEqual({ action: { type: 'call' }, rationale: 'limp call' });
  });

  it('extracts JSON when the model adds wrapping prose', () => {
    const text = 'Here is my move:\n```json\n{"action":{"type":"check"}}\n```';
    const parsed = parseDecisionJson(text);
    expect(parsed?.action).toEqual({ type: 'check' });
  });

  it('returns null on malformed JSON', () => {
    expect(parseDecisionJson('not json at all')).toBeNull();
    expect(parseDecisionJson('{"action":')).toBeNull();
    expect(parseDecisionJson('')).toBeNull();
  });

  it('extracts Anthropic content text from messages response', () => {
    const body = {
      content: [
        { type: 'text', text: '{"action":{"type":"fold"}}' },
        { type: 'text', text: 'trailing' },
      ],
    };
    const text = extractAnthropicText(body);
    expect(text).toContain('"action"');
    expect(text).toContain('trailing');
  });

  it('extracts OpenAI-compatible content text from chat completions response', () => {
    const body = {
      choices: [{ message: { content: '{"action":{"type":"check"}}' } }],
    };
    const text = extractOpenAIText(body);
    expect(text).toContain('"action":{"type":"check"}');
  });

  it('returns empty string on malformed provider envelopes', () => {
    expect(extractAnthropicText({})).toBe('');
    expect(extractAnthropicText({ content: 'nope' })).toBe('');
    expect(extractOpenAIText({})).toBe('');
    expect(extractOpenAIText({ choices: [] })).toBe('');
  });
});

describe('LLM coerce / validation', () => {
  function legalNoBet() {
    return {
      fold: true,
      check: true,
      call: false,
      callTo: 0,
      canBet: true,
      canRaise: false,
      minBetTo: 100,
      maxBetTo: 9000,
      minRaiseTo: 0,
      maxRaiseTo: 0,
    };
  }
  function legalFacingBet() {
    return {
      fold: true,
      check: false,
      call: true,
      callTo: 300,
      canBet: false,
      canRaise: true,
      minBetTo: 0,
      maxBetTo: 0,
      minRaiseTo: 600,
      maxRaiseTo: 9000,
    };
  }

  it('passes legal fold', () => {
    expect(coerceAction({ type: 'fold' }, legalNoBet())).toEqual({ type: 'fold' });
  });

  it('rejects check when facing a bet', () => {
    expect(coerceAction({ type: 'check' }, legalFacingBet())).toBeNull();
  });

  it('clamps bet amount into [min,max]', () => {
    expect(coerceAction({ type: 'bet', amount: 0 }, legalNoBet())).toEqual({ type: 'bet', amount: 100 });
    expect(coerceAction({ type: 'bet', amount: 999999 }, legalNoBet())).toEqual({ type: 'bet', amount: 9000 });
  });

  it('clamps raise amount into [min,max]', () => {
    expect(coerceAction({ type: 'raise', amount: 100 }, legalFacingBet())).toEqual({ type: 'raise', amount: 600 });
    expect(coerceAction({ type: 'raise', amount: 999999 }, legalFacingBet())).toEqual({ type: 'raise', amount: 9000 });
  });

  it('rejects unknown types and non-finite amounts', () => {
    expect(coerceAction({ type: 'wat' }, legalNoBet())).toBeNull();
    expect(coerceAction({ type: 'bet', amount: 'lots' }, legalNoBet())).toBeNull();
    expect(coerceAction({ type: 'bet', amount: NaN }, legalNoBet())).toBeNull();
    expect(coerceAction(null, legalNoBet())).toBeNull();
    expect(coerceAction({}, legalNoBet())).toBeNull();
  });
});
