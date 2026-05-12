import { describe, it, expect } from 'vitest';
// @ts-expect-error — importing the bridge .mjs for unit tests; no .d.ts ship.
import { redactSecrets, summarizeArgvForDiag, formatCliFailureDiag, extractActionFromReply } from '../bridge/moltfire-bridge.mjs';

describe('redactSecrets', () => {
  it('masks anthropic / openai sk-* keys', () => {
    const out = redactSecrets('Authorization: sk-ant-api03-AAA1112223334444zzzz');
    expect(out).not.toContain('sk-ant-api03-AAA1112223334444zzzz');
    expect(out).toContain('sk-***');
  });

  it('masks openclaw oc_* tokens', () => {
    const out = redactSecrets('token=oc_abcdef1234567890qrstuv');
    expect(out).toContain('oc_***');
    expect(out).not.toContain('abcdef1234567890qrstuv');
  });

  it('masks bearer headers', () => {
    const out = redactSecrets('Authorization: Bearer some.long.jwt.value.zzz');
    expect(out).toMatch(/Authorization:\s*Bearer\s+\*\*\*/i);
    expect(out).not.toContain('some.long.jwt.value.zzz');
  });

  it('masks x-api-key headers', () => {
    const out = redactSecrets('x-api-key: super-secret-key-value');
    expect(out).not.toContain('super-secret-key-value');
    expect(out).toContain('***');
  });

  it('masks POKERCLAW_AGENT_API_KEY=...', () => {
    const out = redactSecrets('POKERCLAW_AGENT_API_KEY=sk-ant-12345678abcdefgh');
    expect(out).not.toContain('sk-ant-12345678abcdefgh');
    expect(out).toContain('POKERCLAW_AGENT_API_KEY=***');
  });

  it('returns empty string for non-strings', () => {
    expect(redactSecrets(null as unknown as string)).toBe('');
    expect(redactSecrets(undefined as unknown as string)).toBe('');
    expect(redactSecrets(123 as unknown as string)).toBe('');
  });

  it('leaves benign text untouched', () => {
    const benign = 'cli-exit-1';
    expect(redactSecrets(benign)).toBe(benign);
  });
});

describe('summarizeArgvForDiag', () => {
  it('redacts the --message value with a length marker (never echoes prompt body)', () => {
    const argv = [
      'agent',
      '--agent', 'moltfire-poker',
      '--session-id', 'moltfire-pokerclaw',
      '--message', 'super secret prompt body with hole cards Ah Kd',
      '--json',
      '--timeout', '30',
    ];
    const out = summarizeArgvForDiag(argv);
    expect(out).not.toContain('Ah');
    expect(out).not.toContain('Kd');
    expect(out).not.toContain('super secret prompt body');
    expect(out).toContain('--message');
    expect(out).toContain('<redacted:');
    expect(out).toContain('moltfire-poker');
    expect(out).toContain('--timeout');
    expect(out).toContain('30');
  });

  it('preserves non-message argv elements but still redacts secret-shaped tokens', () => {
    const argv = ['agent', '--token', 'oc_abc12345abc12345abc12345'];
    const out = summarizeArgvForDiag(argv);
    expect(out).toContain('oc_***');
    expect(out).not.toContain('oc_abc12345abc12345abc12345');
  });

  it('returns [] for non-array input', () => {
    expect(summarizeArgvForDiag(undefined as unknown as string[])).toBe('[]');
  });
});

describe('formatCliFailureDiag', () => {
  it('includes cmd, cwd, argv shape, stage, exitCode, and stderr head/tail', () => {
    const line = formatCliFailureDiag({
      cmd: 'C:\\node_modules\\openclaw\\openclaw.mjs',
      argv: ['agent', '--agent', 'moltfire-poker', '--message', 'x'.repeat(2048)],
      cwd: 'C:\\Projects\\PokerClaw',
      diag: {
        stage: 'non-zero-exit',
        exitCode: 1,
        stderrText: 'GatewayClientRequestError: provider/model overrides are not authorized for this caller.',
        stdoutHead: '',
      },
    });
    expect(line).toContain('[bridge] cli-failure');
    expect(line).toContain('cmd=C:\\node_modules\\openclaw\\openclaw.mjs');
    expect(line).toContain('cwd=C:\\Projects\\PokerClaw');
    expect(line).toContain('stage=non-zero-exit');
    expect(line).toContain('exitCode=1');
    expect(line).toContain('GatewayClientRequestError');
    // The --message value must be redacted in the argv summary.
    expect(line).not.toContain('x'.repeat(100));
    expect(line).toContain('<redacted:2048b>');
  });

  it('redacts secrets inside stderr text', () => {
    const line = formatCliFailureDiag({
      cmd: 'openclaw',
      argv: ['agent'],
      cwd: '/tmp',
      diag: {
        stage: 'non-zero-exit',
        exitCode: 1,
        stderrText: 'auth failed: Bearer leak-this-token-please-no\nsecond line',
      },
    });
    expect(line).not.toContain('leak-this-token-please-no');
    expect(line).toContain('***');
  });

  it('marks timeout vs non-zero exit distinctly', () => {
    const exitLine = formatCliFailureDiag({
      cmd: 'openclaw',
      argv: [],
      cwd: '/tmp',
      diag: { stage: 'non-zero-exit', exitCode: 1, stderrText: '' },
    });
    expect(exitLine).toContain('stage=non-zero-exit');
    expect(exitLine).not.toContain('timedOut=true');

    const timeoutLine = formatCliFailureDiag({
      cmd: 'openclaw',
      argv: [],
      cwd: '/tmp',
      diag: { stage: 'timeout', timedOut: true, timeoutMs: 31000, stderrText: '' },
    });
    expect(timeoutLine).toContain('stage=timeout');
    expect(timeoutLine).toContain('timedOut=true');
    expect(timeoutLine).toContain('timeoutMs=31000');
  });
});

describe('extractActionFromReply — accepts flat shape', () => {
  it('accepts {"action":"check","amount":0,"rationale":"..."}', () => {
    const out = extractActionFromReply('{"action":"check","amount":0,"rationale":"pot control"}');
    expect(out).not.toBeNull();
    expect(out.action).toEqual({ type: 'check' });
    expect(out.rationale).toBe('pot control');
  });

  it('accepts flat bet with integer amount and normalizes', () => {
    const out = extractActionFromReply('{"action":"bet","amount":350,"rationale":"x"}');
    expect(out.action).toEqual({ type: 'bet', amount: 350 });
  });

  it('rejects flat bet with non-integer amount', () => {
    const out = extractActionFromReply('{"action":"bet","amount":350.5,"rationale":"x"}');
    expect(out).toBeNull();
  });

  it('rejects an unknown flat action type', () => {
    const out = extractActionFromReply('{"action":"all-in","amount":0,"rationale":""}');
    expect(out).toBeNull();
  });

  it('still accepts the nested shape (back-compat)', () => {
    const out = extractActionFromReply('{"action":{"type":"call"},"rationale":"go"}');
    expect(out.action).toEqual({ type: 'call' });
    expect(out.rationale).toBe('go');
  });
});
