# MoltFire OpenClaw Bridge — PokerClaw

## Goal

Make PokerClaw actually play against MoltFire, not just a generic LLM. The live agent must call out to a dedicated MoltFire OpenClaw session that carries his persona, SOUL/MEMORY context, and constitution. This is the "truest version" of MoltFire-as-opponent.

The existing direct-Anthropic and OpenAI-compatible adapters stay as fallback. The new OpenClaw bridge becomes the default when configured.

---

## Why

Right now PokerClaw's LLM strategy talks directly to a chat completions API with a small system prompt. That is not MoltFire. It is "MoltFire-flavored Sonnet."

A dedicated OpenClaw MoltFire session represents the actual MoltFire identity Wes interacts with. Routing live poker decisions through that session preserves persona, fair-play behavior, and durable context.

---

## High-Level Architecture

```text
Browser UI (Wes)
        |
        | /api/player/wes/action
        v
PokerClaw Dealer Server
        ^
        | GET /api/ai/state
        | POST /api/ai/action
        |
MoltFire Live Agent (Node)
        |
        | bridge.decide(authorizedState)
        v
MoltFire Bridge Adapter (new)
        |
        | local HTTP request to bridge sidecar
        v
MoltFire Bridge Sidecar (new local Node service)
        |
        | sessions_send-style call to dedicated MoltFire OpenClaw session
        v
OpenClaw MoltFire Session
        |
        | returns JSON poker decision as the next assistant turn
        v
Sidecar -> Agent -> Dealer
```

Two new local components:

1. **MoltFire Bridge Adapter** inside `agent/strategy/openclaw-bridge.ts`.
2. **MoltFire Bridge Sidecar** at `bridge/moltfire-bridge.mjs` (or similar) — a small local HTTP service that knows how to talk to the OpenClaw session.

This split is important. The PokerClaw agent never embeds OpenClaw credentials directly. It only talks to the local sidecar through localhost HTTP.

---

## Hard Requirements

1. Localhost-only sidecar bound to `127.0.0.1`.
2. No PokerClaw client code may import OpenClaw internals directly.
3. The sidecar must request only an authorized MoltFire poker state, never Wes's hole cards.
4. The dedicated MoltFire OpenClaw session must be configured to refuse to read or guess hidden state during a live hand.
5. The sidecar must return strict JSON action only. No free-form chain-of-thought returned to the agent or logged with hole cards.
6. The PokerClaw agent must validate any returned action against `legalActions` before posting, identical to the existing LLM adapter.
7. Existing rule strategy stays as the safety-net fallback.
8. Existing direct LLM adapter (Anthropic/OpenAI-compatible) stays as an alternate provider when the bridge is unavailable.
9. Privacy: still no hole cards in logs in Match Mode.
10. The bridge must never use the main MoltFire OpenClaw session that talks to Wes. A separate dedicated session is required so live chat is not interrupted.

---

## Configuration

Add to `.env.example`:

```text
POKERCLAW_AGENT_BRIDGE_ENABLED=false
POKERCLAW_AGENT_BRIDGE_URL=http://127.0.0.1:5179
POKERCLAW_AGENT_BRIDGE_TIMEOUT_MS=15000
POKERCLAW_AGENT_BRIDGE_SESSION_LABEL=moltfire-pokerclaw
```

If `POKERCLAW_AGENT_BRIDGE_ENABLED=true` and the bridge responds, that strategy wins.
Else fall back to direct LLM strategy.
Else fall back to rule strategy.

Strategy chain order:

1. `openclaw-bridge` (new)
2. `llm` (existing direct LLM)
3. `rules` (existing fallback)

---

## Sidecar API

### Endpoint

```text
POST http://127.0.0.1:5179/decide
Content-Type: application/json
```

### Request body

```json
{
  "mode": "match",
  "publicHandContext": {
    "handId": 42,
    "street": "turn",
    "pot": 1300,
    "currentBet": 0,
    "bigBlind": 200,
    "myStack": 8400,
    "opponentStack": 7100,
    "myCommittedThisStreet": 0,
    "opponentCommittedThisStreet": 0,
    "board": ["Ah", "9d", "2s", "Jh"],
    "myHoleCards": ["Qd", "Qs"],
    "actionHistory": [
      { "street": "preflop", "player": "wes", "action": { "type": "raise", "amount": 300 } },
      { "street": "preflop", "player": "moltfire", "action": { "type": "call" } },
      { "street": "flop", "player": "wes", "action": { "type": "check" } },
      { "street": "flop", "player": "moltfire", "action": { "type": "bet", "amount": 350 } },
      { "street": "flop", "player": "wes", "action": { "type": "call" } },
      { "street": "turn", "player": "wes", "action": { "type": "check" } }
    ],
    "legalActions": {
      "fold": true,
      "check": true,
      "call": false,
      "callTo": 0,
      "canBet": true,
      "canRaise": false,
      "minBetTo": 200,
      "maxBetTo": 8400,
      "minRaiseTo": 0,
      "maxRaiseTo": 0
    }
  }
}
```

### Response body

Strict JSON:

```json
{
  "action": { "type": "bet", "amount": 650 },
  "rationale": "value-shape on a wet board, sizing for protection"
}
```

Other valid actions:

```json
{ "action": { "type": "fold" } }
{ "action": { "type": "check" } }
{ "action": { "type": "call" } }
{ "action": { "type": "raise", "amount": 1100 } }
```

If invalid or missing fields, agent treats as null and falls back.

---

## Sidecar Internals

The sidecar is a small Node script.

Responsibilities:

1. Accept the `decide` request.
2. Construct a strict, persona-faithful message for the dedicated MoltFire OpenClaw session.
3. Send the message to the MoltFire OpenClaw session through OpenClaw's session-send mechanism. Recommended: use whatever OpenClaw CLI / IPC pattern Wes already uses for cross-session messaging (e.g. `openclaw sessions send --label moltfire-pokerclaw <message>`).
4. Wait for the next assistant reply.
5. Extract the JSON action block.
6. Validate JSON structure.
7. Return the JSON action.

If anything fails: timeout, malformed JSON, illegal action, missing session, return HTTP 502 with `{ "error": "<reason>" }`. The agent will fall back to direct LLM, then rules.

### Message Template Sent to MoltFire OpenClaw Session

```text
PokerClaw decision request.

This is a live heads-up NLHE hand. You are MoltFire, the poker opponent. Match Mode is active. Fair Play Protocol applies. Do not reveal live hole cards anywhere except inside this JSON. Do not include chain-of-thought. Output JSON only.

Public hand context:
<json-block>

Your task: choose exactly one legal action. The "amount" you return for bet/raise is the TOTAL committed amount for this street after the action, not the chip delta. Output strict JSON in this shape:

{
  "action": { "type": "fold" | "check" | "call" | "bet" with "amount" | "raise" with "amount" },
  "rationale": "<one-line public-safe rationale>"
}

Do not output any text other than the JSON.
```

The dedicated MoltFire OpenClaw session should be set up with a small system addendum acknowledging this contract.

---

## Dedicated MoltFire OpenClaw Session

The bridge requires a dedicated MoltFire session, separate from Wes's main MoltFire chat. Reasons:

- Avoids interrupting live chat with poker decisions.
- Keeps poker context out of normal MEMORY/conversation flow.
- Lets Wes inspect and pause poker MoltFire independently.

How to set it up will depend on OpenClaw's session management, but the goal:

- A persistent labeled MoltFire session at `moltfire-pokerclaw`.
- Configured with `SOUL.md`, `MOLTFIRE_CONSTITUTION.md`, and `C:\Projects\PokerClaw\FAIR_PLAY_PROTOCOL.md` as primary context.
- Acknowledges the JSON-only output contract.
- Operates in Match Mode by default unless Wes explicitly switches it.
- Never reveals hole cards in chat. Only inside the returned JSON.
- Allowed to discuss strategy publicly only after the hand completes, if Wes asks.

If OpenClaw does not support a separate persistent labeled session in this exact shape today, the sidecar must at least ensure it does not pipe poker decisions into Wes's primary MoltFire session.

---

## PokerClaw Agent Changes

Files likely changed:

- `agent/strategy/openclaw-bridge.ts` — new
- `agent/strategy/index.ts` — add bridge as first strategy in the chain
- `agent/config.ts` — read bridge env vars
- `agent/types.ts` — new optional bridge config
- `.env.example` — new vars
- `README.md` — document bridge mode

Behavior:

- If `POKERCLAW_AGENT_BRIDGE_ENABLED=true`:
  - Strategy chain order: bridge -> llm -> rules.
- Else:
  - Strategy chain order: llm -> rules.

The bridge adapter calls `POST http://127.0.0.1:5179/decide` with the authorized state already filtered the same way the LLM adapter filters it.

The adapter validates the response action against `legalActions`. If invalid, it returns `null` and falls through to the next strategy.

---

## Startup Logging

The agent startup banner must clearly say which strategy is active and where decisions are routed. Examples:

- Bridge active:
  ```text
  [agent] starting mode=match strategy=openclaw-bridge sessionLabel=moltfire-pokerclaw fallback=llm,rules pollMs=750 dryRun=false
  ```
- Bridge configured but offline:
  ```text
  [agent] starting mode=match strategy=llm reason=bridge_unreachable fallback=rules
  ```
- Bridge disabled:
  ```text
  [agent] starting mode=match strategy=llm fallback=rules
  ```

Hole cards never appear in startup logs.

---

## Sidecar Run Commands

Add scripts:

- `npm run bridge` — start the MoltFire OpenClaw bridge sidecar.
- `npm run bridge:dry-run` — run sidecar in mock mode that returns a deterministic legal action without contacting OpenClaw, so agent + bridge wiring can be tested without burning OpenClaw quota.

---

## Tests

Required tests:

1. Bridge adapter returns the parsed action when sidecar returns a valid JSON action.
2. Bridge adapter returns `null` on sidecar HTTP error, timeout, malformed JSON, or illegal action.
3. Bridge adapter does not include opponent hole cards or future board cards in the outgoing request.
4. Strategy chain prefers bridge over LLM when bridge is enabled and returns a valid decision.
5. Strategy chain falls back to LLM when bridge returns null.
6. Strategy chain falls back to rules when both fail.
7. Sidecar dry-run mode returns a legal action without contacting any external service.

All existing PokerClaw tests must still pass.

---

## Hard Safety Rules

- Localhost-only bridge.
- No OpenClaw credentials stored in PokerClaw repo.
- No real or live MoltFire chat session is used as the poker session. Must be a dedicated labeled session.
- No hole-card leaks in logs, including bridge logs.
- No bridge logs of full LLM responses including chain-of-thought.
- No third-party LLM provider added by this change. Existing providers only.
- No bypass of the existing race-bug fix. The agent loop stays sequential with in-flight key guards.

---

## Acceptance Criteria

Stop only when all of these hold:

1. `agent/strategy/openclaw-bridge.ts` exists and is wired into the strategy chain.
2. `bridge/moltfire-bridge.mjs` (or equivalent) exists with `POST /decide` and a working dry-run mode.
3. New env vars exist and are documented in `.env.example` and `README.md`.
4. Strategy chain is correctly ordered when bridge is enabled.
5. Startup banner accurately reflects the active strategy.
6. Bridge adapter validates returned action against `legalActions`.
7. All new tests pass.
8. All existing tests pass.
9. `npm test` passes.
10. `npm run build` passes.
11. README documents how Wes sets up the dedicated MoltFire OpenClaw session label and how to launch the bridge.
12. No privacy regressions in any view-models or logs.

If a real blocker prevents real OpenClaw session-send integration in this environment, the sidecar must ship with the dry-run path operational and clearly mark live-bridge mode as TODO, instead of weakening the safety rules.

---

## `/goal` Prompt to Paste into Claude Code

```text
/goal Implement MOLTFIRE_OPENCLAW_BRIDGE.md inside C:\Projects\PokerClaw. Add a new local "openclaw-bridge" strategy adapter to agent/strategy/openclaw-bridge.ts and wire it into the strategy chain before the existing llm and rules strategies. Add a localhost-only bridge sidecar at bridge/moltfire-bridge.mjs (or equivalent), bound to 127.0.0.1, exposing POST /decide that accepts the documented public hand context and returns a strict JSON action. Add a dry-run mode that returns a deterministic legal action without contacting OpenClaw. Add env vars POKERCLAW_AGENT_BRIDGE_ENABLED, POKERCLAW_AGENT_BRIDGE_URL, POKERCLAW_AGENT_BRIDGE_TIMEOUT_MS, POKERCLAW_AGENT_BRIDGE_SESSION_LABEL with sensible defaults. Update README and .env.example. Keep the existing race-bug-fix sequential loop and in-flight decision guard. Preserve all privacy boundaries: no opponent hole cards in agent state, no hole cards in logs, no full chain-of-thought in logs, localhost-only. Add tests for: bridge adapter happy path, bridge adapter failure fallbacks, strategy chain order with bridge enabled and disabled, dry-run mode. Stop only when bridge sidecar dry-run mode works end-to-end with the live agent, all new and existing tests pass, npm test and npm run build pass, README documents how to set up the dedicated MoltFire OpenClaw session labeled moltfire-pokerclaw, and the agent startup banner correctly reports the active strategy. If real OpenClaw session-send wiring is not feasible from this environment, ship dry-run mode fully working and clearly mark live-bridge wiring as TODO without weakening any safety rule. If blocked, report the exact blocker.
```
