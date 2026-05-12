import { describe, it, expect } from 'vitest';
import { loadAgentConfig, resolveLLMConfig, parseProvider, describeStartup } from '../agent/config';

const BASE_ENV: NodeJS.ProcessEnv = {
  POKERCLAW_AGENT_ENABLED: 'true',
  POKERCLAW_AGENT_MODE: 'match',
  POKERCLAW_AGENT_POLL_MS: '750',
  POKERCLAW_SERVER_URL: 'http://127.0.0.1:3001',
};

describe('agent config — provider selection', () => {
  it('returns no LLM config when provider is unset', () => {
    expect(resolveLLMConfig(BASE_ENV)).toBeUndefined();
  });

  it('returns no LLM config when provider is set but model/key are missing', () => {
    expect(resolveLLMConfig({ ...BASE_ENV, POKERCLAW_AGENT_LLM_PROVIDER: 'anthropic' })).toBeUndefined();
    expect(
      resolveLLMConfig({
        ...BASE_ENV,
        POKERCLAW_AGENT_LLM_PROVIDER: 'anthropic',
        POKERCLAW_AGENT_API_KEY: 'sk-foo',
      }),
    ).toBeUndefined();
    expect(
      resolveLLMConfig({
        ...BASE_ENV,
        POKERCLAW_AGENT_LLM_PROVIDER: 'anthropic',
        POKERCLAW_AGENT_MODEL: 'claude-x',
      }),
    ).toBeUndefined();
  });

  it('builds an anthropic config with sensible defaults', () => {
    const cfg = resolveLLMConfig({
      ...BASE_ENV,
      POKERCLAW_AGENT_LLM_PROVIDER: 'anthropic',
      POKERCLAW_AGENT_API_KEY: 'sk-xxx',
      POKERCLAW_AGENT_MODEL: 'claude-3-5-sonnet-latest',
    });
    expect(cfg).toBeDefined();
    expect(cfg!.provider).toBe('anthropic');
    expect(cfg!.apiUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(cfg!.timeoutMs).toBe(5000);
  });

  it('builds an openai-compatible config with overridable URL', () => {
    const cfg = resolveLLMConfig({
      ...BASE_ENV,
      POKERCLAW_AGENT_LLM_PROVIDER: 'openai-compatible',
      POKERCLAW_AGENT_API_KEY: 'sk-xxx',
      POKERCLAW_AGENT_MODEL: 'gpt-4.1-mini',
      POKERCLAW_AGENT_API_URL: 'http://localhost:1234/v1/chat/completions',
    });
    expect(cfg!.provider).toBe('openai-compatible');
    expect(cfg!.apiUrl).toBe('http://localhost:1234/v1/chat/completions');
  });

  it('treats `off` and unknown providers identically', () => {
    expect(parseProvider('off')).toBe('off');
    expect(parseProvider('huggingface')).toBe('off');
    expect(parseProvider(undefined)).toBe('off');
  });

  it('clamps timeout to [1000, 30000]', () => {
    const cfg = resolveLLMConfig({
      ...BASE_ENV,
      POKERCLAW_AGENT_LLM_PROVIDER: 'anthropic',
      POKERCLAW_AGENT_API_KEY: 'sk',
      POKERCLAW_AGENT_MODEL: 'm',
      POKERCLAW_AGENT_TIMEOUT_MS: '60000',
    });
    expect(cfg!.timeoutMs).toBe(30000);
  });
});

describe('agent startup banner', () => {
  it('degrades to rules when fast-live is the default but no model is configured', () => {
    const cfg = loadAgentConfig(BASE_ENV, []);
    const line = describeStartup(cfg);
    expect(line).toContain('strategy=rules');
    expect(line).toContain('reason=no_api_key');
    expect(line).toContain('requested=fast-live');
    // Must never leak card data.
    expect(line).not.toMatch(/[2-9TJQKA][cdhs]/);
  });

  it('reports fast-live mode and provider when a provider+model is configured by default', () => {
    const cfg = loadAgentConfig(
      {
        ...BASE_ENV,
        POKERCLAW_AGENT_LLM_PROVIDER: 'anthropic',
        POKERCLAW_AGENT_API_KEY: 'sk-xxx',
        POKERCLAW_AGENT_MODEL: 'claude-3-5-sonnet-latest',
      },
      [],
    );
    const line = describeStartup(cfg);
    expect(line).toContain('strategy=fast-live');
    expect(line).toContain('provider=anthropic');
    expect(line).toContain('model=claude-3-5-sonnet-latest');
    expect(line).toContain('fallback=rules');
    expect(line).toContain('shortcuts=enabled');
  });

  it('honors POKERCLAW_FAST_MODEL override for the fast path', () => {
    const cfg = loadAgentConfig(
      {
        ...BASE_ENV,
        POKERCLAW_AGENT_LLM_PROVIDER: 'anthropic',
        POKERCLAW_AGENT_API_KEY: 'sk-xxx',
        POKERCLAW_AGENT_MODEL: 'claude-opus-fallback',
        POKERCLAW_FAST_MODEL: 'claude-haiku-fast',
      },
      [],
    );
    expect(cfg.fastLive?.model).toBe('claude-haiku-fast');
    expect(describeStartup(cfg)).toContain('model=claude-haiku-fast');
  });

  it('clamps fast-live timeout to <= 5000ms', () => {
    const cfg = loadAgentConfig(
      {
        ...BASE_ENV,
        POKERCLAW_AGENT_LLM_PROVIDER: 'anthropic',
        POKERCLAW_AGENT_API_KEY: 'sk',
        POKERCLAW_AGENT_MODEL: 'm',
        POKERCLAW_FAST_TIMEOUT_MS: '60000',
      },
      [],
    );
    expect(cfg.fastLive?.timeoutMs).toBe(5000);
  });

  it('reports strategy=rules when POKERCLAW_STRATEGY=rules', () => {
    const cfg = loadAgentConfig({ ...BASE_ENV, POKERCLAW_STRATEGY: 'rules' }, []);
    expect(cfg.strategy).toBe('rules');
    expect(describeStartup(cfg)).toContain('strategy=rules');
  });
});
