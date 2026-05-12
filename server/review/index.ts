import type { HandSnapshot } from '../training';
import { formatSession } from './format';
import { COACH_SYSTEM_PROMPT, buildReviewUserMessage } from './prompt';

// Resolves the model + API config for the reviewer from environment. Reuses
// POKERCLAW_AGENT_API_KEY (same provider account as the agent) and picks
// POKERCLAW_REVIEW_MODEL when set, else POKERCLAW_AGENT_MODEL. The reviewer
// always uses Anthropic — it's the only provider with the long-form reasoning
// quality this task needs by default. OPENAI-compatible can be wired later.
export type ReviewConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
};

export function resolveReviewConfig(env: NodeJS.ProcessEnv): ReviewConfig | null {
  const apiKey = env.POKERCLAW_AGENT_API_KEY?.trim() ?? '';
  if (!apiKey) return null;
  const model =
    env.POKERCLAW_REVIEW_MODEL?.trim() ||
    env.POKERCLAW_AGENT_MODEL?.trim() ||
    'claude-sonnet-4-6';
  const apiUrl =
    env.POKERCLAW_REVIEW_API_URL?.trim() ||
    env.POKERCLAW_AGENT_API_URL?.trim() ||
    'https://api.anthropic.com/v1/messages';
  const timeoutMs = clampInt(env.POKERCLAW_REVIEW_TIMEOUT_MS, 5000, 180000, 90000);
  const maxTokens = clampInt(env.POKERCLAW_REVIEW_MAX_TOKENS, 512, 16384, 4096);
  return { apiUrl, apiKey, model, timeoutMs, maxTokens };
}

function clampInt(raw: string | undefined, lo: number, hi: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

export type ReviewResult = {
  ok: true;
  markdown: string;
  handCount: number;
  model: string;
  latencyMs: number;
};

export type ReviewError = {
  ok: false;
  reason: 'no-config' | 'empty-buffer' | 'http-error' | 'timeout' | 'parse-error';
  message: string;
};

// Generates a coaching review for the given hand snapshots. Returns a
// discriminated union — callers route on `ok`.
export async function generateReview(
  hands: HandSnapshot[],
  env: NodeJS.ProcessEnv,
): Promise<ReviewResult | ReviewError> {
  if (hands.length === 0) {
    return { ok: false, reason: 'empty-buffer', message: 'No hands were captured.' };
  }
  const cfg = resolveReviewConfig(env);
  if (!cfg) {
    return {
      ok: false,
      reason: 'no-config',
      message: 'No POKERCLAW_AGENT_API_KEY configured for the reviewer.',
    };
  }
  const userMessage = buildReviewUserMessage(formatSession(hands));
  const started = Date.now();
  try {
    const markdown = await callAnthropicReview(cfg, userMessage);
    return {
      ok: true,
      markdown,
      handCount: hands.length,
      model: cfg.model,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted')) {
      return { ok: false, reason: 'timeout', message: 'Reviewer call timed out.' };
    }
    if (msg.includes('parse')) {
      return { ok: false, reason: 'parse-error', message: msg };
    }
    return { ok: false, reason: 'http-error', message: msg };
  }
}

async function callAnthropicReview(cfg: ReviewConfig, user: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        temperature: 0.3,
        system: COACH_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: user }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // Don't echo the body — provider error responses occasionally include
      // hints about request internals we'd rather not surface.
      throw new Error(`anthropic http ${res.status}`);
    }
    const body = (await res.json()) as { content?: unknown };
    return extractMarkdown(body);
  } finally {
    clearTimeout(timer);
  }
}

// Extracts the markdown content from an Anthropic Messages API response.
// Mirrors agent/strategy/llm/parse.ts but inlined here so the server doesn't
// import agent code.
export function extractMarkdown(body: unknown): string {
  if (!body || typeof body !== 'object') {
    throw new Error('parse: empty response');
  }
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error('parse: missing content array');
  }
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const t = (block as { text?: unknown }).text;
      if (typeof t === 'string') parts.push(t);
    }
  }
  const joined = parts.join('\n').trim();
  if (!joined) throw new Error('parse: no text blocks');
  return joined;
}

export { formatSession } from './format';
export { COACH_SYSTEM_PROMPT, buildReviewUserMessage } from './prompt';
