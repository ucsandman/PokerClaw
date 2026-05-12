import type { LLMConfig } from '../../types';
import { extractOpenAIText } from './parse';

// Calls an OpenAI-compatible chat completions endpoint and returns the
// assistant message content. Defaults to OpenAI's official URL but can be
// pointed at any compatible API (LM Studio, Ollama-compatible, etc.) via
// POKERCLAW_AGENT_API_URL.
export async function callOpenAICompatible(
  cfg: LLMConfig,
  system: string,
  user: string,
): Promise<string> {
  const url = cfg.apiUrl || 'https://api.openai.com/v1/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.45,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`openai http ${res.status}`);
    const body = await res.json();
    return extractOpenAIText(body);
  } finally {
    clearTimeout(timer);
  }
}
