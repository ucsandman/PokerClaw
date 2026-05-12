import type { LLMConfig } from '../../types';
import { extractAnthropicText } from './parse';

// Calls the Anthropic Messages API and returns the first text content block.
// Default endpoint: https://api.anthropic.com/v1/messages
//
// Headers: x-api-key, anthropic-version: 2023-06-01.
// Throws on HTTP errors or timeout — callers (strategy entry) catch and
// fall back to the rule strategy.
export async function callAnthropic(
  cfg: LLMConfig,
  system: string,
  user: string,
): Promise<string> {
  const url = cfg.apiUrl || 'https://api.anthropic.com/v1/messages';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 300,
        temperature: 0.45,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`anthropic http ${res.status}`);
    const body = await res.json();
    return extractAnthropicText(body);
  } finally {
    clearTimeout(timer);
  }
}
