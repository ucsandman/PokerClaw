# PokerClaw Live Agent Architecture

## Problem

The MVP works, but MoltFire is currently turn-based through Telegram/chat:

1. Wes takes an action.
2. Wes tells MoltFire it is his turn.
3. MoltFire queries `/api/ai/state`.
4. MoltFire posts `/api/ai/action`.

This proves the privacy/API model, but it is too slow for actual play.

Goal: make MoltFire feel live at the table.

---

## Recommended Direction

Add a local `moltfire-agent` service that watches the game state and automatically acts when `currentActor === "moltfire"`.

The agent must still obey the fair-play protocol:

- It may only consume the authorized MoltFire state view.
- It may only act through the MoltFire action endpoint.
- It must not inspect server internals, files, logs, debug endpoints, or Wes's UI.
- It should not reveal MoltFire hole cards in chat/logs during Match Mode.

---

## Important Constraint

The live agent is not literally the same OpenClaw chat session unless wired through OpenClaw session APIs, which would still be slower and more fragile.

Best practical design:

- Main MoltFire/OpenClaw remains the companion, reviewer, strategist, and post-hand analyst.
- Local `moltfire-agent` is a focused poker-playing runtime that uses the same fair-play rules and a compact MoltFire poker persona.
- The live agent can write hand summaries for review after completion.

This gives the table a real-time opponent without forcing every action through Telegram.

---

## Architecture

```text
Browser UI (Wes)
      |
      | /api/player/wes/action
      v
PokerClaw Server  <------------------  MoltFire Agent Service
      |                                  |
      | authorized state                 | polls or subscribes
      | /api/ai/state                    |
      |                                  |
      | action                           |
      | /api/ai/action                   |
      v                                  v
Game State in Memory              LLM / Strategy Engine
```

---

## Service Options

### Option A: Polling Agent, Fastest MVP

A Node script runs locally:

```bash
npm run agent
```

Loop:

1. Poll `GET /api/ai/state` every 500-1000ms.
2. If `currentActor !== "moltfire"`, keep waiting.
3. If current hand/action spot was already processed, do nothing.
4. If it is MoltFire's turn, choose an action.
5. POST action to `/api/ai/action`.
6. Wait for next turn.

Pros:

- Simple.
- Easy to build.
- No WebSocket dependency.
- Good enough for local play.

Cons:

- Slight polling delay.
- Needs duplicate-action protection.

Recommendation: build this first.

### Option B: WebSocket/SSE Agent

Server emits game updates over WebSocket/SSE. Agent listens and acts immediately when it sees MoltFire's turn.

Pros:

- More live feel.
- Less polling.

Cons:

- More moving parts.
- Need reconnection logic.

Recommendation: Phase 2 after polling works.

### Option C: In-Browser AI Button

UI has a button: “Let MoltFire Act”.

Pros:

- Simple UX.
- Still faster than Telegram.

Cons:

- Not truly live.
- Wes still has to click.

Recommendation: optional fallback, not the main solution.

---

## Strategy Engine Levels

### Level 0: Rule-Based Toy Bot

For testing only.

- Open playable hands.
- C-bet some boards.
- Fold trash to pressure.
- No LLM needed.

Useful for app testing but not the real goal.

### Level 1: LLM Poker Agent

Use an LLM API call when it is MoltFire's turn.

Input:

- Authorized MoltFire state.
- Fair-play rules.
- Match/training/debug mode.
- Compact strategy instructions.
- Legal actions.

Output:

```json
{
  "action": { "type": "bet", "amount": 175 },
  "tableTalk": "optional short line with no hole-card reveal",
  "privateReasoningSummary": "optional post-hand-safe summary, no chain-of-thought"
}
```

The service validates returned action against `legalActions` before posting.

### Level 2: Hybrid Agent

Combine simple heuristics with LLM:

- Heuristics for trivial spots.
- LLM for interesting decisions.
- Faster and cheaper.

Recommendation: Level 1 first, then hybrid if latency/cost annoys us.

---

## Agent Configuration

Add `.env.example`:

```text
POKERCLAW_AGENT_ENABLED=true
POKERCLAW_AGENT_MODE=match
POKERCLAW_AGENT_POLL_MS=750
POKERCLAW_AGENT_MODEL=openai/gpt-4.1-mini
POKERCLAW_AGENT_API_KEY=
POKERCLAW_SERVER_URL=http://127.0.0.1:3001
```

Never commit real API keys.

If using OpenClaw/Gateway later, document that separately. MVP should use a direct provider SDK only if Wes wants live autonomous play.

---

## Privacy Rules for Live Agent

The agent process must not import or access server internal `GameState` directly.

It should be its own process that talks only over HTTP:

- `GET /api/ai/state`
- `POST /api/ai/action`

Do not place the agent inside the same module with direct state access unless strict boundaries are still enforced by using the public API client.

Do not log:

- MoltFire live hole cards.
- Wes hole cards before hand completion.
- Full authorized state during live hands.

Safe logs:

```text
[agent] hand=12 street=flop actor=moltfire legal=fold,call,raise action=call
```

Unsafe logs:

```text
[agent] I have AhQs and Wes has hidden cards...
```

Even MoltFire's own cards should not be printed during Match Mode because Wes may see terminal logs.

---

## Duplicate Action Protection

The agent needs to avoid acting twice on the same decision point.

Use a decision key like:

```ts
const decisionKey = JSON.stringify({
  handId: state.handId,
  street: state.street,
  actionCount: state.actionHistory.length,
  currentActor: state.currentActor,
  currentBet: state.currentBet,
  pot: state.pot
});
```

Keep `lastDecisionKeyActed` in memory.

If the key matches the previous acted key, do not act again.

---

## Latency Target

For local play:

- Poll interval: 500-750ms.
- LLM decision latency target: under 3 seconds.
- Action posted immediately after validation.

If LLM is too slow, add:

- “thinking...” indicator in UI.
- timeout fallback check/fold for testing only, disabled in serious Match Mode.

---

## UI Additions

Add a small agent status panel:

- Agent: Connected / Disconnected.
- Mode: Match / Training / Debug.
- Last action time.
- Thinking indicator when MoltFire is deciding.
- Pause agent button if possible.

Optional endpoint:

```http
GET /api/agent/status
```

Only if the server supervises the agent. If the agent is independent, the status can be skipped for MVP.

---

## Claude Code Build Plan

### Milestone 1: Agent Client

- Add `agent/` directory.
- Build HTTP client for `/api/ai/state` and `/api/ai/action`.
- Add polling loop.
- Add duplicate-action guard.
- Add safe logging.
- Add dry-run mode that prints chosen action without posting.

### Milestone 2: Simple Strategy Adapter

- Implement a deterministic rule-based strategy first for testing.
- Ensure it chooses only legal actions.
- Add tests for action selection against sample states.

### Milestone 3: LLM Strategy Adapter

- Add provider abstraction.
- Read model/API key from env.
- Prompt with fair-play rules and authorized state only.
- Require JSON output.
- Validate output against legal actions.
- Fallback safely if model returns invalid action.

### Milestone 4: Scripts and Docs

Add scripts:

```json
{
  "dev": "concurrently ...",
  "agent": "tsx agent/index.ts",
  "agent:dry-run": "tsx agent/index.ts --dry-run"
}
```

Update README:

- How to run server/UI.
- How to run agent.
- How to configure env.
- Match/Training/Debug mode explanation.

### Milestone 5: Optional UI Status

- Add agent status indicator if practical.
- Add pause/resume if practical.

---

## Definition of Done

The live-agent upgrade is done when:

1. Wes can start PokerClaw.
2. Wes can start MoltFire agent with one command.
3. Wes can act in the browser.
4. When it becomes MoltFire's turn, the agent acts automatically.
5. No Telegram message is needed per turn.
6. The agent never receives or logs Wes's hidden hole cards.
7. The agent does not reveal MoltFire's live hole cards in logs/chat.
8. Duplicate actions are prevented.
9. Tests pass.
10. README documents the workflow.

---

## Recommended Next Prompt for Claude Code

Ask Claude Code to implement `LIVE_AGENT_ARCHITECTURE.md`, starting with Option A polling agent and Level 0 rule-based strategy, then Level 1 LLM adapter behind env config.
