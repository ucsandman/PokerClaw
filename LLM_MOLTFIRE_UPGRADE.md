# PokerClaw LLM MoltFire Upgrade

## Goal

Upgrade PokerClaw so Wes is playing against a real LLM-backed MoltFire agent, not just the deterministic rule bot.

The current rule strategy proved the live-agent architecture works, but it is too basic. It can be stacked by any competent player. The next version should use an LLM for actual poker decisions while preserving all fair-play boundaries.

---

## Current State

The live agent currently uses a strategy chain:

1. LLM strategy if configured.
2. Rule strategy fallback.

But the LLM implementation is currently OpenAI-compatible only and depends on env vars:

```text
POKERCLAW_AGENT_MODEL=
POKERCLAW_AGENT_API_KEY=
POKERCLAW_AGENT_API_URL=https://api.openai.com/v1/chat/completions
```

If model/key are blank, the agent uses the deterministic rule bot.

---

## Desired Upgrade

Make the LLM strategy first-class and easy to run with either:

- Anthropic Claude API, preferred if available.
- OpenAI-compatible chat completions, as fallback.
- Rule strategy only as safety net, not normal play.

The goal is not solver-perfect poker. The goal is a live MoltFire opponent that:

- Understands the spot.
- Adapts to action history.
- Uses legal bet sizes.
- Bluffs sometimes.
- Value bets sensibly.
- Does not punt randomly.
- Does not reveal private cards.
- Feels like a real opponent.

---

## Provider Design

Add provider support like this:

```text
POKERCLAW_AGENT_LLM_PROVIDER=anthropic | openai-compatible | off
POKERCLAW_AGENT_MODEL=claude-3-5-sonnet-latest
POKERCLAW_AGENT_API_KEY=...
POKERCLAW_AGENT_API_URL=optional override
POKERCLAW_AGENT_TIMEOUT_MS=5000
```

Recommended defaults:

```text
POKERCLAW_AGENT_LLM_PROVIDER=off
POKERCLAW_AGENT_MODEL=
POKERCLAW_AGENT_API_KEY=
POKERCLAW_AGENT_TIMEOUT_MS=5000
```

Do not commit real keys.

---

## Anthropic Adapter

Add an Anthropic messages API adapter.

Endpoint:

```text
https://api.anthropic.com/v1/messages
```

Headers:

```text
x-api-key: <key>
anthropic-version: 2023-06-01
content-type: application/json
```

Request shape:

```json
{
  "model": "claude-3-5-sonnet-latest",
  "max_tokens": 300,
  "temperature": 0.45,
  "system": "...system prompt...",
  "messages": [
    {
      "role": "user",
      "content": "...authorized poker state..."
    }
  ]
}
```

Response content is usually:

```json
{
  "content": [
    { "type": "text", "text": "{...json...}" }
  ]
}
```

Parse the first text block.

---

## Strategy Prompt Requirements

The LLM should receive only the authorized MoltFire state.

Include:

- Mode: match/training/debug.
- Street.
- Pot.
- Current bet.
- Big blind.
- Effective stacks.
- My stack.
- Opponent stack.
- My committed amount this street.
- Opponent committed amount this street.
- Board.
- MoltFire hole cards.
- Legal actions.
- Action history, if available in sanitized form.

Do not include:

- Wes hole cards before showdown.
- Deck order.
- Future cards.
- Raw server state.
- Debug state.

Important: include action history. The current `StrategyInput` does not appear to include full action history, which makes LLM decisions weaker. Add a sanitized action history field that contains only public actions.

---

## Output Schema

Require strict JSON:

```json
{
  "action": {
    "type": "fold"
  },
  "tableTalk": "optional short table line, no private-card reveal",
  "rationale": "short public-safe summary, no chain-of-thought"
}
```

Other valid action examples:

```json
{ "action": { "type": "check" } }
{ "action": { "type": "call" } }
{ "action": { "type": "bet", "amount": 300 } }
{ "action": { "type": "raise", "amount": 900 } }
```

`amount` means total committed for the current street after the action.

The model must never output chain-of-thought. Only a short rationale like:

- "small c-bet on favorable board"
- "folding weak high-card hand to pressure"
- "value raising strong made hand"

---

## Validation Rules

Model output is advisory only. The agent must validate before posting.

- Unknown action type -> reject.
- Fold only if legal.
- Check only if legal.
- Call only if legal.
- Bet only if canBet and amount clamps within min/max.
- Raise only if canRaise and amount clamps within min/max.
- If model output invalid, fall back to rule strategy.
- If rule strategy invalid somehow, use safe fallback:
  1. check if legal
  2. call if legal and cheap
  3. fold if legal
  4. otherwise error without posting

---

## Make LLM Mode Obvious

The user should know whether they are playing the rule bot or LLM MoltFire.

Add startup log:

```text
[agent] starting mode=match strategy=llm provider=anthropic model=claude-3-5-sonnet-latest fallback=rules
```

If no key/model:

```text
[agent] starting mode=match strategy=rules reason=no_llm_config
```

Do not log hole cards.

---

## Improve Agent Input

Update `StrategyInput` to include:

```ts
publicActionHistory: Array<{
  street: string;
  player: 'wes' | 'moltfire';
  action: { type: string; amount?: number };
  potAfter: number;
}>;
```

No private cards in history until showdown. In live hand decision prompts, public actions only.

---

## Prompt Personality

Use `MOLTFIRE_POKER_AGENT_CONTRACT.md` as the behavioral contract.

The LLM should play like:

- Competitive.
- Fair.
- Direct.
- Not solver-perfect.
- Willing to bluff.
- Willing to fold.
- Not a passive calling station.
- Not a manic overbettor.

Do not overdo table talk. Default to no table talk or short action-only table talk.

---

## Tests

Add or update tests for:

1. Anthropic response parsing.
2. OpenAI-compatible response parsing still works.
3. Provider selection from env.
4. Prompt builder excludes opponent hidden cards.
5. Prompt builder includes public action history.
6. Invalid LLM action falls back to rules.
7. Invalid provider config uses rules.
8. Startup config correctly reports strategy mode without leaking cards.

Existing tests must still pass:

```bash
npm test
npm run build
```

---

## Definition of Done

The upgrade is done when:

1. Wes can configure an Anthropic or OpenAI-compatible LLM through `.env`.
2. `npm run agent` clearly reports whether it is using LLM or rules.
3. When LLM is configured, agent decisions use LLM first.
4. Rules are fallback only.
5. The prompt contains no hidden Wes cards or deck info.
6. The agent acts automatically as before.
7. No live private cards appear in logs.
8. Tests and build pass.
9. README explains how to enable LLM mode.

---

## Claude Code Prompt

Implement `LLM_MOLTFIRE_UPGRADE.md`.

Prioritize:

1. Anthropic provider adapter.
2. Provider config/env cleanup.
3. Public action history in StrategyInput and prompts.
4. Clear startup logging showing LLM vs rules.
5. Validation/fallback safety.
6. README and `.env.example` updates.
7. Tests.

Do not weaken any privacy boundary. Do not log hole cards. Do not expose full game state. Keep rule strategy as fallback, but make LLM mode the intended real-play path when configured.
