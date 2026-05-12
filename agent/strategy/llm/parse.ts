// Parsing the LLM's textual response into a structured candidate.
// The model is asked for strict JSON, but we still defensively extract the
// first JSON object from the response in case there is wrapping prose.

export type ParsedDecision = {
  action: unknown;
  tableTalk?: string;
  rationale?: string;
};

export function parseDecisionJson(text: string): ParsedDecision | null {
  if (!text) return null;
  const candidate = text.trim();

  // Try strict JSON first.
  const direct = tryParseObject(candidate);
  if (direct) return shape(direct);

  // Fallback: find the first {...} block.
  const start = candidate.indexOf('{');
  if (start === -1) return null;
  // Balance braces — naive but enough for the small JSON we expect.
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(start, i + 1);
        const parsed = tryParseObject(slice);
        if (parsed) return shape(parsed);
        return null;
      }
    }
  }
  return null;
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function shape(obj: Record<string, unknown>): ParsedDecision | null {
  if (!('action' in obj)) return null;
  const tableTalk = typeof obj.tableTalk === 'string' ? obj.tableTalk : undefined;
  const rationale = typeof obj.rationale === 'string' ? obj.rationale : undefined;
  return { action: obj.action, tableTalk, rationale };
}

// ----- Provider response extraction --------------------------------------
// Each provider response is a different envelope around the model's text.

// Anthropic Messages API: { content: [{ type:'text', text:'...' }, ...] }
export function extractAnthropicText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const blocks = (body as { content?: unknown }).content;
  if (!Array.isArray(blocks)) return '';
  const parts: string[] = [];
  for (const b of blocks) {
    if (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text') {
      const txt = (b as { text?: unknown }).text;
      if (typeof txt === 'string') parts.push(txt);
    }
  }
  return parts.join('\n');
}

// OpenAI-compatible chat completions: { choices: [{ message: { content: '...' } }] }
export function extractOpenAIText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as { message?: { content?: unknown } };
  const content = first?.message?.content;
  return typeof content === 'string' ? content : '';
}
