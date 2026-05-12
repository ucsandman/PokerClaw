import { describe, it, expect } from 'vitest';
import { resolveOpponentProfile } from '../server/opponent';

describe('resolveOpponentProfile', () => {
  it('returns a generic Opponent when nothing is configured', () => {
    const p = resolveOpponentProfile({});
    expect(p.name).toBe('Opponent');
    expect(p.emoji).toBe('🤖');
    expect(p.source).toBe('default');
  });

  it('returns "Rule Bot" when strategy=rules', () => {
    const p = resolveOpponentProfile({ POKERCLAW_STRATEGY: 'rules' });
    expect(p.name).toBe('Rule Bot');
    expect(p.emoji).toBe('🎲');
    expect(p.source).toBe('default');
  });

  it('returns the model name when strategy=fast-live', () => {
    const p = resolveOpponentProfile({
      POKERCLAW_STRATEGY: 'fast-live',
      POKERCLAW_FAST_MODEL: 'claude-haiku-4-5',
    });
    expect(p.name).toBe('claude-haiku-4-5');
    expect(p.emoji).toBe('⚡');
  });

  it('falls back to POKERCLAW_AGENT_MODEL for fast-live name', () => {
    const p = resolveOpponentProfile({
      POKERCLAW_STRATEGY: 'fast-live',
      POKERCLAW_AGENT_MODEL: 'claude-sonnet-4-6',
    });
    expect(p.name).toBe('claude-sonnet-4-6');
  });

  it('returns OpenClaw Agent placeholder when openclaw-bridge is selected but no identity', () => {
    const p = resolveOpponentProfile({ POKERCLAW_STRATEGY: 'openclaw-bridge' });
    expect(p.name).toBe('OpenClaw Agent');
    expect(p.emoji).toBe('🦞');
    expect(p.theme).toBe('red');
  });

  it('uses POKERCLAW_OPPONENT_NAME override regardless of strategy', () => {
    const p = resolveOpponentProfile({
      POKERCLAW_STRATEGY: 'rules',
      POKERCLAW_OPPONENT_NAME: 'MoltFire',
      POKERCLAW_OPPONENT_EMOJI: '🔥',
      POKERCLAW_OPPONENT_THEME: 'red',
    });
    expect(p.name).toBe('MoltFire');
    expect(p.emoji).toBe('🔥');
    expect(p.theme).toBe('red');
    expect(p.source).toBe('config');
  });

  it('marks the source as openclaw when POKERCLAW_OPPONENT_FROM_OPENCLAW=true', () => {
    const p = resolveOpponentProfile({
      POKERCLAW_OPPONENT_NAME: 'MoltFire',
      POKERCLAW_OPPONENT_FROM_OPENCLAW: 'true',
    });
    expect(p.source).toBe('openclaw');
  });

  it('passes through avatar URL', () => {
    const p = resolveOpponentProfile({
      POKERCLAW_OPPONENT_NAME: 'Bot',
      POKERCLAW_OPPONENT_AVATAR: 'https://example.com/avatar.png',
    });
    expect(p.avatarUrl).toBe('https://example.com/avatar.png');
  });

  it('trims and treats empty strings as unset', () => {
    const p = resolveOpponentProfile({
      POKERCLAW_OPPONENT_NAME: '   ',
      POKERCLAW_OPPONENT_EMOJI: '',
      POKERCLAW_STRATEGY: 'fast-live',
      POKERCLAW_FAST_MODEL: '   ',
      POKERCLAW_AGENT_MODEL: 'gpt-4',
    });
    expect(p.name).toBe('gpt-4');
  });
});
