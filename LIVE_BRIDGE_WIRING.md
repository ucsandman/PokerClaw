# Live MoltFire OpenClaw Bridge Wiring

## Status

The PokerClaw OpenClaw bridge is wired end-to-end in dry-run mode. The agent's strategy chain is `openclaw-bridge -> llm -> rules`, the sidecar is bound to `127.0.0.1:5179`, the adapter validates returned actions against `legalActions`, and all 126 tests plus build pass.

The remaining piece is `dispatchToOpenClaw(ctx, sessionLabel)` inside `bridge/moltfire-bridge.mjs`. It currently throws `live-bridge-not-wired`, which intentionally falls back to the LLM strategy and then rules.

This document scopes the work to flip the live bridge on.

---

## Goal

When `npm run bridge` runs in live mode, each PokerClaw decision request is routed to a dedicated MoltFire OpenClaw agent session labeled `moltfire-pokerclaw`. That session returns strict JSON, and the bridge forwards it back to the PokerClaw live agent.

The PokerClaw live agent must remain ignorant of any OpenClaw internals. It only talks to `http://127.0.0.1:5179/decide`.

---

## Chosen Transport

Use the existing OpenClaw CLI:

```
openclaw agent --agent <agentId> --session-id moltfire-pokerclaw --message <prompt> --json --timeout 30
```

Why this transport:

- Already installed and version-pinned with the rest of Wes's OpenClaw setup.
- Has explicit `--session-id`, `--json`, `--timeout`, and `--model` overrides.
- Runs locally; no public surface; no new credentials.
- Existing approval policy and exec rails apply automatically.
- Future swap to a gateway HTTP RPC is a one-function change in the bridge sidecar.

### Why a child-process call is acceptable here

- The sidecar is already a trusted-on-host localhost service.
- Wes is the only user of the host.
- Output is parsed as JSON and validated before being returned to PokerClaw.
- No shell expansion: the message argument is passed as a single argv element via `child_process.spawn`, not through `shell: true`. The hand state is the only thing in the prompt; it never contains user-typed shell metacharacters.

---

## Dedicated Agent + Session Strategy

The live bridge runs against a **new isolated OpenClaw agent** named `moltfire-poker`, not the `main` agent. The session id used by the bridge is `moltfire-pokerclaw`, scoped to that isolated agent.

### Why a new isolated agent, not `main`

- Live poker decisions every few seconds would otherwise interrupt Wes's primary MoltFire chat thread on `main`.
- A separate agent has its own workspace, memory, and routing rules, so poker context does not bleed into Wes's daily MoltFire memory, MEMORY.md indexing, or commitment tracking.
- The poker agent can be paused, reconfigured, or deleted (`openclaw agents delete`) without any risk to the `main` MoltFire agent.
- Approval and exec policy can be tighter on this agent because it only ever needs to read public hand state and reply with JSON.
- Failure isolation: a runaway poker session cannot exhaust Wes's main agent's context budget.

### One-time setup (run from `C:\Projects\PokerClaw`)

1. Create the isolated agent.

   ```
   openclaw agents add moltfire-poker
   openclaw agents set-identity moltfire-poker --name "MoltFire (Poker)" --emoji "🔥" --theme red
   ```

2. Confirm it exists alongside `main`.

   ```
   openclaw agents list
   ```

3. Seed the persistent session `moltfire-pokerclaw` with a one-time bootstrap message that loads:
   - `SOUL.md`
   - `MOLTFIRE_CONSTITUTION.md`
   - `C:\Projects\PokerClaw\FAIR_PLAY_PROTOCOL.md`
   - The strict JSON output contract from `MOLTFIRE_OPENCLAW_BRIDGE.md`.

   ```
   openclaw agent --agent moltfire-poker --session-id moltfire-pokerclaw --message "<bootstrap text>" --json --timeout 30
   ```

4. Send one test poker state and confirm the reply is JSON only: no chain of thought, no hole-card leakage, action validates against `legalActions`.

5. Save the agent id and session id into the bridge env:

   ```
   POKERCLAW_BRIDGE_LIVE_AGENT_ID=moltfire-poker
   POKERCLAW_AGENT_BRIDGE_SESSION_LABEL=moltfire-pokerclaw
   ```

### Hard rule

The bridge must refuse to spawn against `--agent main` even if a misconfiguration tries to point it there. Live poker decisions never run inside the main MoltFire agent.

---

## Required Code Changes

All changes are inside `C:\Projects\PokerClaw`. Live agent code is unchanged.

### 1. Implement `dispatchToOpenClaw(ctx, sessionLabel)`

In `bridge/moltfire-bridge.mjs`:

- Build the prompt with the existing `constructPrompt(ctx)`.
- Run `openclaw agent --agent <agentId> --session-id <sessionLabel> --message <prompt> --json --timeout <s>` via `child_process.spawn`.
- Read stdout, parse as JSON.
- The OpenClaw `agent --json` envelope contains the assistant reply. Extract the JSON action block from the reply text.
- Validate against the strict schema:
  - `action.type` in `fold|check|call|bet|raise`.
  - `amount` (when applicable) is a finite integer.
- Return `{ action, rationale }`.
- On any error, throw. The HTTP handler converts to 502 and the agent falls back to its LLM/rules chain.

### 2. Add live-mode config

New env in `.env.example`:

```
POKERCLAW_BRIDGE_LIVE_AGENT_ID=moltfire-poker
POKERCLAW_BRIDGE_LIVE_MODEL=anthropic/claude-sonnet-4-6
POKERCLAW_BRIDGE_LIVE_TIMEOUT_SEC=30
POKERCLAW_BRIDGE_CLI_PATH=openclaw
```

`POKERCLAW_BRIDGE_LIVE_AGENT_ID` must point at the isolated poker agent created above. The bridge must reject `main` (and any documented main-agent aliases) so that poker decisions never run inside Wes's primary MoltFire agent.

`POKERCLAW_BRIDGE_CLI_PATH` lets Wes override the CLI binary path if needed.

### 3. Hard guards in `dispatchToOpenClaw`

- Refuse to run if `sessionLabel` is empty.
- Refuse to run if `agentId` is empty, equals `main`, or matches any other documented main-agent alias.
- Refuse to run if the resolved CLI path is not under a trusted directory (allow `openclaw`, `npx openclaw`, or an absolute Windows path that Wes has configured).
- Cap message length sent to the CLI to a safe ceiling, e.g. 8 KB. The serialized public hand context plus the wrapper is well under this; anything over is a sign the agent is being asked to act on malformed state.
- Never log the rationale text body or the full reply to stdout. Only log:
  - action type
  - bet amount if applicable
  - street and pot
  - source (live | dry-run)
  - agent id and session label

### 4. Parse-and-validate helper

Add `extractActionFromReply(text)` to:

- Find the first `{`...`}` JSON object in the reply.
- Reject any text before/after the JSON if it looks like chain of thought.
- Parse and return `{ action, rationale }` or `null`.

### 5. Failure semantics

- Process exit code != 0 -> throw, 502 to agent, fall back to LLM.
- Parse failure -> throw, 502 to agent, fall back to LLM.
- Illegal action -> throw, 502 to agent, fall back to LLM.
- Timeout -> kill the child process, throw, fall back to LLM.

The agent already handles these via its strategy chain; do not paper over them in the bridge.

---

## Tests to Add

In `tests/agent-bridge.test.ts` (or a new `tests/bridge-live.test.ts`):

1. `constructPrompt(ctx)` excludes opponent hole cards and any deck state.
2. `extractActionFromReply` returns the action when the reply contains valid JSON.
3. `extractActionFromReply` rejects replies with chain-of-thought before/after JSON.
4. `extractActionFromReply` returns null for malformed JSON.
5. The bridge HTTP `/decide` route returns 502 when `dispatchToOpenClaw` throws.
6. Live mode rejects an empty or banned session label.
7. Live mode rejects `agentId === 'main'` (and any other documented main-agent alias) even when paired with a valid session label.
8. Bridge stdout in live mode contains no hole-card strings even when the reply text would have leaked them (because we log only the structured action).
9. CLI argument array uses `spawn` without `shell: true`.

All existing 126 tests must still pass.

---

## End-to-End Manual Test

Once wired, in three terminals:

Terminal 1:

```
cd C:\Projects\PokerClaw
npm run dev
```

Terminal 2 (requires the one-time setup of the `moltfire-poker` agent from "Dedicated Agent + Session Strategy"):

```
cd C:\Projects\PokerClaw
$env:POKERCLAW_BRIDGE_LIVE_AGENT_ID="moltfire-poker"
$env:POKERCLAW_BRIDGE_LIVE_MODEL="anthropic/claude-sonnet-4-6"
npm run bridge
```

Terminal 3:

```
cd C:\Projects\PokerClaw
$env:POKERCLAW_AGENT_BRIDGE_ENABLED="true"
$env:POKERCLAW_AGENT_BRIDGE_URL="http://127.0.0.1:5179"
$env:POKERCLAW_AGENT_BRIDGE_SESSION_LABEL="moltfire-pokerclaw"
npm run agent
```

Expect:

- Agent banner: `strategy=openclaw-bridge sessionLabel=moltfire-pokerclaw fallback=llm,rules`.
- Bridge banner: `mode=live`.
- First few hands: bridge logs `decide street=preflop ... -> raise:300 (live)` style entries.
- No hole-card strings (`Ah`, `Kd`, etc.) appear in any terminal.
- Killing the bridge mid-hand: agent log shows `bridge_unreachable` and continues with `llm` strategy.

---

## Acceptance Criteria

The live bridge is done when all of:

1. `dispatchToOpenClaw` is implemented and routes to the dedicated OpenClaw session via the documented CLI.
2. New env vars exist and are documented in `.env.example` and `README.md`.
3. `npm run bridge` in live mode posts an action for at least 5 consecutive hands without errors.
4. Killing the bridge mid-session results in clean agent fallback to LLM.
5. No hole cards appear in any logs in any mode.
6. All new tests pass.
7. All existing tests pass.
8. `npm test` passes.
9. `npm run build` passes.
10. README documents how to set up the dedicated MoltFire OpenClaw session and how to switch between dry-run and live modes.

If any of these regress, revert to dry-run mode and surface the blocker.

---

## `/goal` Prompt to Paste into Claude Code

```text
/goal Implement LIVE_BRIDGE_WIRING.md inside C:\Projects\PokerClaw. Wire dispatchToOpenClaw in bridge/moltfire-bridge.mjs to route the strict prompt produced by constructPrompt to a dedicated isolated OpenClaw agent named moltfire-poker, session id moltfire-pokerclaw, by spawning `openclaw agent --agent <agentId> --session-id <sessionLabel> --message <prompt> --json --timeout <s>`. Do not use shell:true; pass arguments as argv elements. Default POKERCLAW_BRIDGE_LIVE_AGENT_ID to moltfire-poker and hard-refuse agentId values that are empty, equal main, or match any documented main-agent alias even if env is misconfigured. Add env vars POKERCLAW_BRIDGE_LIVE_AGENT_ID, POKERCLAW_BRIDGE_LIVE_MODEL, POKERCLAW_BRIDGE_LIVE_TIMEOUT_SEC, POKERCLAW_BRIDGE_CLI_PATH with sensible defaults. Parse the CLI's JSON envelope, extract the assistant reply, and run a strict extractActionFromReply that rejects chain-of-thought and only accepts a single JSON object containing { action, rationale }. Validate the action against the legalActions block already in the request body. On any failure (non-zero exit, timeout, malformed JSON, illegal action) throw so the HTTP handler returns 502 and the PokerClaw agent falls back to its LLM and then rules. Refuse empty session labels. Cap the outbound message at 8 KB. Never log hole-card strings or the reply text body; only log structured action summaries that include the agent id and session label. Add tests covering prompt construction, action extraction (happy path, malformed JSON, chain-of-thought rejection), HTTP 502 on dispatch failure, session-label refusal, refusal of agentId=main, and confirmation that spawn is invoked without shell:true. Update .env.example and README to document the moltfire-poker isolated agent setup (`openclaw agents add moltfire-poker`, identity, seed bootstrap message) plus the moltfire-pokerclaw session id and how to switch between dry-run and live modes. Keep dry-run mode operational. Stop only when npm test and npm run build pass, the live bridge can complete at least 5 consecutive decisions against a seeded moltfire-pokerclaw session on the moltfire-poker agent, killing the bridge mid-session results in clean agent fallback to LLM, and no hole cards appear in any logs in any mode. If real OpenClaw session-send wiring is not feasible in this environment, leave the dry-run path fully working and clearly mark the live path as TODO without weakening any safety rule. If blocked, report the exact blocker.
```
