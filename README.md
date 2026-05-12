# PokerClaw

Local heads-up Texas Hold'em sandbox. Wes plays in a browser. MoltFire plays through a restricted JSON API. The Node server is the trusted dealer and never leaks hole cards or deck order before showdown.

Fake chips, local only. Not a gambling product.

See `ARCHITECTURE.md` for the dealer/UI design and `LIVE_AGENT_ARCHITECTURE.md` for the live agent.

---

## Quickstart: `python poker.py`

One command boots the dealer, the Vite UI, the OpenClaw bridge (live mode), and the live agent — and opens the browser when the dealer is healthy.

```powershell
python poker.py
```

Requires Python 3.10+ (stdlib only — no extra dependencies) and `npm install` already run.

What it does:

1. Pre-checks that ports `3001` (dealer), `5173` (UI), and `5179` (bridge) are free.
2. On first run, seeds the dedicated `moltfire-pokerclaw` OpenClaw session with the canonical MoltFire bootstrap message via `openclaw agent --agent moltfire-poker --session-id moltfire-pokerclaw --message <bootstrap> --json --timeout 60`. Subsequent runs skip seeding — a `.poker-seeded` sentinel pins the SHA-256 of the bootstrap text so any change forces a re-seed automatically.
3. Spawns three supervised children with prefixed, color-tagged logs (`[dealer] [ui] [bridge] [agent] [launcher]`) and redacts any `[2-9TJQKA][cdhs]` hole-card pattern from launcher stdout as defense-in-depth.
4. Waits up to 30 s for `GET http://127.0.0.1:3001/api/player/wes/state` to return 200, then opens `http://localhost:5173/` in the default browser.
5. Injects sensible bridge env defaults (`POKERCLAW_AGENT_BRIDGE_ENABLED`, `POKERCLAW_AGENT_BRIDGE_URL`, `POKERCLAW_BRIDGE_LIVE_AGENT_ID=moltfire-poker`, `POKERCLAW_BRIDGE_LIVE_TIMEOUT_SEC=180`) for the children only when the user shell hasn't already set them. `POKERCLAW_BRIDGE_LIVE_MODEL` is deliberately *not* defaulted — OpenClaw rejects `--model` overrides unless the caller is explicitly authorized; operators with override authority can set e.g. `anthropic/claude-sonnet-4-6` in their shell or `.env`.
6. On `Ctrl+C` (or any child exiting non-zero), terminates every child cleanly before returning.

Safety rules baked in: every subprocess is spawned with an argv list and `shell=False` (never `shell=True`); the launcher refuses to start the bridge if `POKERCLAW_BRIDGE_LIVE_AGENT_ID` resolves to a banned alias (`main`, `default`, `primary`, `moltfire`, `moltfire-main`).

### Dry mode

```powershell
python poker.py dry
```

Same boot, but the bridge runs as `bridge:dry-run` (deterministic legal-action stub) and the OpenClaw seed step is skipped. Use this to test the wiring without burning tokens.

### Teardown mode

```powershell
python poker.py teardown
```

Kills any leftover processes still listening on the three ports. Idempotent — safe to run when nothing is bound. Use after a crash or a stray `npm` process to clear the slate.

### Re-seeding

```powershell
python poker.py --force-seed
```

Re-sends the bootstrap message to the `moltfire-pokerclaw` session even if the sentinel SHA already matches the canonical text. Rarely needed; only useful when the OpenClaw side seems to have forgotten context.

### Tests

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
```

Stdlib-only `unittest` suite for the launcher's pure helpers (`redact_hole_cards`, `bootstrap_sha256`, `should_reseed`, `validate_agent_id`, `is_port_free`). Vitest only globs `*.test.{ts,js}`, so the Python file lives alongside the TypeScript specs without colliding.

---

## Install

Requires Node.js 18+ and npm.

```bash
npm install
```

## Run (development)

Two processes: the Express dealer (port `3001`) and the Vite dev UI (port `5173`, proxies `/api` → the dealer).

```bash
npm run dev
```

Then open: **http://localhost:5173**

## Run (production build)

Builds the UI, then serves both the API and the static UI from the dealer on `:3001`.

```bash
npm run build
npm start
```

Open: **http://localhost:3001**

## Test / typecheck

```bash
npm test          # vitest run
npm run typecheck # tsc --noEmit
npm run build     # type-check + build
```

## Configuration

Copy `.env.example` → `.env` to override defaults. Both the dealer (`npm start`, `npm run dev:server`) and the live agent (`npm run agent`) auto-load `.env` from the project root via [`dotenv`](https://github.com/motdotla/dotenv). Real environment variables take precedence — `.env` only fills in what's not already set. `.env` is gitignored.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Dealer port. Vite dev proxy expects this. |
| `POKERCLAW_STARTING_STACK` | `10000` | Per-player starting stack on session start. |
| `POKERCLAW_DEBUG_FULL_STATE` | `0` | Set to `1` to expose `/api/debug/full-state` (off by default — it returns raw `GameState` and is for development only). |
| `POKERCLAW_AGENT_ENABLED` | `true` | Set `false` to make `npm run agent` exit immediately. |
| `POKERCLAW_AGENT_MODE` | `match` | `match` / `training` / `debug`. Controls log strictness — hole cards only appear in `debug`. |
| `POKERCLAW_AGENT_POLL_MS` | `750` | Agent poll interval, clamped to 250–5000. |
| `POKERCLAW_SERVER_URL` | `http://127.0.0.1:3001` | Dealer URL the agent talks to. |
| `POKERCLAW_AGENT_LLM_PROVIDER` | `off` | `anthropic` / `openai-compatible` / `off`. Selects the LLM adapter. |
| `POKERCLAW_AGENT_MODEL` | (unset) | Model name (e.g. `claude-3-5-sonnet-latest`, `gpt-4.1-mini`). Empty = rules only. |
| `POKERCLAW_AGENT_API_KEY` | (unset) | API key for the configured provider. Empty = rules only. Never commit. |
| `POKERCLAW_AGENT_API_URL` | (provider default) | Override the endpoint URL. Useful for OpenAI-compatible local servers. |
| `POKERCLAW_AGENT_TIMEOUT_MS` | `5000` | LLM call timeout, clamped to 1000–30000. |
| `POKERCLAW_AGENT_BRIDGE_ENABLED` | `false` | When `true`, the agent prefers the local MoltFire OpenClaw bridge sidecar over the direct LLM call. Chain becomes `openclaw-bridge → llm → rules`. |
| `POKERCLAW_AGENT_BRIDGE_URL` | `http://127.0.0.1:5179` | Where the agent expects the sidecar. **Must be localhost** — anything else is rejected at load time. |
| `POKERCLAW_AGENT_BRIDGE_TIMEOUT_MS` | `15000` | Per-`/decide` call timeout, clamped to 1000–60000. |
| `POKERCLAW_AGENT_BRIDGE_SESSION_LABEL` | `moltfire-pokerclaw` | Dedicated OpenClaw session the sidecar targets. Must not collide with Wes's main MoltFire chat. |
| `POKERCLAW_BRIDGE_LIVE_AGENT_ID` | `moltfire-poker` | Sidecar-only. Isolated OpenClaw agent the live CLI is invoked against. The bridge **hard-refuses** `main`, `default`, `primary`, `moltfire`, `moltfire-main`. |
| `POKERCLAW_BRIDGE_LIVE_MODEL` | (unset) | Sidecar-only. Model override passed through to `openclaw agent --model`. Empty = use the agent's configured default. |
| `POKERCLAW_BRIDGE_LIVE_TIMEOUT_SEC` | `30` | Sidecar-only. Per-decide CLI timeout, clamped to 1–300. Child is killed on expiry. |
| `POKERCLAW_BRIDGE_CLI_PATH` | `openclaw` | Sidecar-only. CLI binary. Allowed: `openclaw`, `npx`, or an absolute Windows / POSIX path. Anything else is rejected. |

---

## Blind schedule

Hand-count-based tournament structure in `shared/blinds.ts`:

| Level | Hands | Blinds |
| --- | --- | --- |
| 1 | 1–10 | 50 / 100 |
| 2 | 11–20 | 75 / 150 |
| 3 | 21–30 | 100 / 200 |
| 4 | 31–40 | 150 / 300 |
| 5 | 41–50 | 200 / 400 |
| 6 | 51–60 | 300 / 600 |
| 7 | 61–70 | 400 / 800 |
| 8 | 71+ | 500 / 1000 |

The level is locked when a hand starts — blinds never change mid-hand. The UI header shows current level, current blinds, next level's blinds, and the hand-countdown until the bump. Each `PlayerView` includes a `tournament` block; tests in `tests/blinds.test.ts` and `tests/new-hand.test.ts` lock the hand→level mapping.

---

## API endpoints

All endpoints return scrubbed authorized views via `viewForPlayer`. The full `GameState` (including the deck and the other player's hole cards) is never serialized.

### Wes (browser)

- `GET /api/player/wes/state` → `PlayerView` for Wes.
- `POST /api/player/wes/action` body `PlayerAction` → `PlayerView`.
- `POST /api/new-hand` → `{ ok: true }` (only legal when the current hand is complete).
- `POST /api/reset` → `{ ok: true }` (resets the session to a fresh starting stack).

### MoltFire (API client)

- `GET /api/ai/state` → `PlayerView` for MoltFire.
- `POST /api/ai/action` body `PlayerAction` → `PlayerView`.

### Agent heartbeat

The local agent posts a small status payload each tick so the UI can show "LLM mode" / "Rule bot" / "Agent offline".

- `POST /api/agent/status` body `{ strategy, provider?, model?, mode }` → `{ ok: true }`.
- `GET /api/agent/status` → `AgentStatus` (or `{ connected: false }` if nothing has ever heart-beaten). Heartbeats expire after 5 seconds without a refresh.

### Action payloads

`PlayerAction` is one of:

```json
{ "type": "fold" }
{ "type": "check" }
{ "type": "call" }
{ "type": "bet",   "amount": 300 }
{ "type": "raise", "amount": 600 }
```

**`amount` is the player's *total committed amount for the current street* after the action**, not the additional chips put in. Example: if the current bet is 100 and you want to raise to a total of 300, send `{ "type": "raise", "amount": 300 }`.

`PlayerView` includes a `legalActions` block with the current allowed actions and the min/max amounts MoltFire should use.

### Example MoltFire session

Fetch the current view:

```bash
curl -s http://localhost:3001/api/ai/state | jq
```

Call when it's MoltFire's turn:

```bash
curl -s -X POST http://localhost:3001/api/ai/action \
  -H 'Content-Type: application/json' \
  -d '{"type":"call"}' | jq
```

Min-raise:

```bash
curl -s -X POST http://localhost:3001/api/ai/action \
  -H 'Content-Type: application/json' \
  -d '{"type":"raise","amount":200}' | jq
```

Fold:

```bash
curl -s -X POST http://localhost:3001/api/ai/action \
  -H 'Content-Type: application/json' \
  -d '{"type":"fold"}' | jq
```

After the hand completes, Wes clicks **Deal next hand** in the browser (or `POST /api/new-hand`).

---

## Live MoltFire agent

The agent is a separate Node process that polls the dealer and acts whenever it is MoltFire's turn. It talks to the dealer **only** through the public `/api/ai/state` and `/api/ai/action` endpoints — never imports server internals, never reads server files, never sees Wes's hole cards.

### Run

```bash
npm run agent           # acts live
npm run agent:dry-run   # chooses actions and logs them, but does NOT post
```

Make sure the dealer is already running (`npm run dev` or `npm start`). The agent exits cleanly on Ctrl-C.

### Strategy chain

The agent tries strategies in order. The first to return a decision wins:

1. **OpenClaw bridge** — used when `POKERCLAW_AGENT_BRIDGE_ENABLED=true`. Routes the decision through the localhost MoltFire OpenClaw bridge sidecar so the actual dedicated MoltFire session (with his SOUL/MEMORY/constitution context) plays the hand. See [MoltFire OpenClaw bridge](#moltfire-openclaw-bridge) below.
2. **LLM** — used when `POKERCLAW_AGENT_LLM_PROVIDER` is set to `anthropic` or `openai-compatible` AND model/key are present. The strategy builds a compact prompt with the authorized state plus the public action history, calls the provider, parses JSON, and validates the action against `legalActions`. Any failure (network, timeout, malformed response, illegal action) falls through silently.
3. **Rules** — deterministic toy bot covering preflop strength bands and postflop evaluator categories. Always picks a legal action. This is the default when no LLM and no bridge are configured.
4. **Safe fallback** — last-resort ladder: `check` if legal → `call` if cheap (≤ 1 BB to call) → `fold`. Provides a guaranteed legal action even if everything above misbehaves.

Startup logs report which strategy is active:

```text
[agent] starting mode=match strategy=openclaw-bridge sessionLabel=moltfire-pokerclaw bridgeUrl=http://127.0.0.1:5179 fallback=llm,rules pollMs=750 dryRun=false
[agent] starting mode=match strategy=llm provider=anthropic model=claude-3-5-sonnet-latest fallback=rules pollMs=750 dryRun=false
[agent] starting mode=match strategy=rules reason=no_llm_config pollMs=750 dryRun=false
```

### Enabling Claude (Anthropic)

In `.env`:

```ini
POKERCLAW_AGENT_LLM_PROVIDER=anthropic
POKERCLAW_AGENT_MODEL=claude-3-5-sonnet-latest
POKERCLAW_AGENT_API_KEY=sk-ant-...
```

The adapter calls `https://api.anthropic.com/v1/messages` with `anthropic-version: 2023-06-01` and expects a single text content block containing the JSON decision.

### Enabling OpenAI / OpenAI-compatible

```ini
POKERCLAW_AGENT_LLM_PROVIDER=openai-compatible
POKERCLAW_AGENT_MODEL=gpt-4.1-mini
POKERCLAW_AGENT_API_KEY=sk-...
# Optional override for local servers (LM Studio, vLLM, etc.):
# POKERCLAW_AGENT_API_URL=http://localhost:1234/v1/chat/completions
```

### MoltFire OpenClaw bridge

The OpenClaw bridge is what makes PokerClaw play *the actual MoltFire*, not just a generic LLM. The agent calls a small localhost sidecar; the sidecar forwards the public hand context to a dedicated MoltFire OpenClaw session (with SOUL/MEMORY/constitution context) and returns the JSON action.

Architecture wall:

- `agent/strategy/openclaw-bridge.ts` — the agent-side adapter. Talks HTTP to the sidecar only. Never imports OpenClaw internals, never reads credentials, never logs response bodies (rationale text is treated as private).
- `bridge/moltfire-bridge.mjs` — the local sidecar. Binds to `127.0.0.1` only. Exposes `POST /decide` and `GET /health`. In dry-run mode it returns a deterministic legal action with no external call. In live mode it spawns the OpenClaw CLI against the isolated `moltfire-poker` agent (never `main`) and parses the strict JSON reply.

#### Set up the dedicated MoltFire OpenClaw agent + session

The bridge **never** uses Wes's `main` MoltFire agent. It runs against an isolated agent named `moltfire-poker` with its own workspace, memory, and routing. The session label `moltfire-pokerclaw` is scoped to that agent. The sidecar hard-refuses to spawn against `main`, `default`, `primary`, `moltfire`, or `moltfire-main` even if env is misconfigured.

One-time setup (run from `C:\Projects\PokerClaw`):

```bash
# 1. Create the isolated agent
openclaw agents add moltfire-poker
openclaw agents set-identity moltfire-poker --name "MoltFire (Poker)" --emoji "🔥" --theme red

# 2. Confirm it exists alongside main
openclaw agents list

# 3. Seed the persistent session with a one-time bootstrap that loads SOUL,
#    constitution, fair-play protocol, and the strict JSON output contract.
openclaw agent --agent moltfire-poker --session-id moltfire-pokerclaw \
  --message "$(cat SOUL.md MOLTFIRE_CONSTITUTION.md FAIR_PLAY_PROTOCOL.md MOLTFIRE_OPENCLAW_BRIDGE.md)" \
  --json --timeout 30

# 4. Send one test poker state and confirm the reply is JSON only — no
#    chain-of-thought, no hole-card leakage, action validates against legalActions.
```

The matching `.env` settings:

```ini
POKERCLAW_BRIDGE_LIVE_AGENT_ID=moltfire-poker
POKERCLAW_AGENT_BRIDGE_SESSION_LABEL=moltfire-pokerclaw
```

#### Run the bridge (dry-run vs live)

```bash
# Terminal 1: dealer
npm run dev

# Terminal 2 — dry-run: deterministic legal action, no CLI call. Use this to
# validate wiring without burning OpenClaw quota.
npm run bridge:dry-run

# Terminal 2 — live: routes each /decide to `moltfire-poker` via the OpenClaw CLI.
# Requires the one-time setup above.
$env:POKERCLAW_BRIDGE_LIVE_AGENT_ID="moltfire-poker"
$env:POKERCLAW_BRIDGE_LIVE_MODEL="anthropic/claude-sonnet-4-6"
npm run bridge

# Terminal 3: agent with bridge enabled
$env:POKERCLAW_AGENT_BRIDGE_ENABLED="true"
$env:POKERCLAW_AGENT_BRIDGE_SESSION_LABEL="moltfire-pokerclaw"
npm run agent
```

Health check:

```bash
curl -s http://127.0.0.1:5179/health
# {"ok":true,"mode":"live","sessionLabel":"moltfire-pokerclaw"}
```

#### Live wiring

`dispatchToOpenClaw()` in `bridge/moltfire-bridge.mjs` spawns the OpenClaw CLI directly:

```
openclaw agent --agent <agentId> --session-id <sessionLabel> --message <prompt> --json --timeout <s>
```

The sidecar uses `child_process.spawn` with `shell:false` — every argument is a separate argv element so the prompt can never reach a shell parser. The CLI's JSON envelope is parsed, the assistant reply is extracted, and `extractActionFromReply` rejects anything other than a single `{ action, rationale }` JSON object (no chain-of-thought before or after, no extra fields, integer amounts only). The returned action is then validated against the same `legalActions` block the agent sent in. On any failure (non-zero exit, timeout, malformed envelope, illegal action) the `/decide` handler returns 502 and the PokerClaw agent falls back to its LLM and then rules chain.

The sidecar logs only structured action summaries — action type + bet amount + street + pot + source + agent id + session label. It never logs hole cards, the rationale text body, or the CLI's reply text. The safety rules above remain non-negotiable.

#### Privacy

- Sidecar binds to `127.0.0.1` only. Hostname guards reject non-localhost requests as an extra defense.
- The adapter sends only the same authorized fields the LLM adapter sees — public board, the agent's own hole cards, public action history, legal actions. Opponent hole cards are not in the agent's state to begin with.
- The bridge sidecar logs only `street`, `pot`, and the chosen action type. Rationale text is never logged. Hole cards are never logged.
- Configuration rejects non-localhost bridge URLs at load time.

### What the LLM sees

The prompt contains: mode, street, pot, current bet, big blind, effective and per-player stacks, public board, **MoltFire's own hole cards**, the legal actions block (including min/max amounts), and a sanitized public action history. It does **not** contain Wes's hole cards, the deck, future board cards, or any debug state. The system message bans chain-of-thought and private-card reveals.

### Coverage

The agent is covered by Vitest suites:

- `tests/agent-strategy.test.ts` — rule strategy always picks a legal action.
- `tests/agent-llm.test.ts` — prompt builder excludes opponent cards and includes public history; Anthropic/OpenAI response extraction; JSON parsing of strict and wrapped output; action coercion clamping.
- `tests/agent-config.test.ts` — provider selection from env, defaults, timeout clamping, startup banner content (including the openclaw-bridge banner and the localhost URL guard).
- `tests/agent-chain.test.ts` — chain falls through declining strategies; safe fallback's check / cheap-call / fold ladder; chain ordering with the bridge enabled and disabled.
- `tests/agent-bridge.test.ts` — bridge adapter happy path, HTTP failure / timeout / malformed JSON / illegal action fallbacks; outgoing payload never carries Wes's hole cards; sidecar dry-run end-to-end against a real loopback `POST /decide`.

### Modes

Set via `POKERCLAW_AGENT_MODE`:

- `match` (default) — production play. **Hole cards never appear in logs.**
- `training` — same privacy as match; reserved for future verbose-but-safe logs.
- `debug` — may print hole cards. Do **not** use when Wes can see the terminal.

### Duplicate-action protection

The agent keeps a `lastDecisionKey` in memory built from `{handId, street, actionCount, actor, currentBet, pot}`. If the next poll returns the same key, it skips acting. Failed action posts do NOT advance the key, so transient errors retry on the next tick.

### Privacy posture

- The agent process never receives Wes's hole cards (the dealer's authorized view never includes them before showdown).
- In `match` mode the agent does not print its own hole cards either.
- The agent does not use the `/api/debug/full-state` endpoint.

---

## Privacy guarantees

Enforced and tested in `tests/privacy.test.ts`:

- Wes's view never contains MoltFire's hole cards before showdown.
- MoltFire's view never contains Wes's hole cards before showdown.
- Neither view contains the deck or any future board cards.
- On a fold, the loser's cards stay hidden — only the winner's reveal is published, and even that is filtered to keep folder cards private.
- On a showdown, both players see both real hole-card sets.

These tests recursively walk the serialized view JSON looking for `{rank,suit}` shapes, so they fail loudly if a future change accidentally leaks a card or returns `GameState` directly.

---

## Project layout

```
shared/         pure TypeScript poker engine (cards, deck, types, actions, game, evaluator, view-models)
server/         Express dealer (state.ts holds the session, routes.ts maps HTTP → engine)
src/            Vite + React UI (App.tsx, components/)
agent/          MoltFire live agent (client, log, strategy/{rules,llm}, polling loop)
tests/          Vitest suites: deck, evaluator, new-hand, legal-actions, betting-round, showdown, privacy, agent-strategy
```

---

## Out of scope

This is a tiny local sandbox. Intentionally NOT in scope:

- Real money or anything resembling gambling.
- Public hosting, multi-machine play, or remote access — the server binds to `127.0.0.1` only.
- Accounts, sessions, auth, telemetry, persistence beyond in-memory state.
- Side pots beyond the simple uncalled-bet refund used for all-in heads-up situations.
- Tournaments, ICM, blind structures, time banks.
- Solver integration. (A local LLM strategy is in scope via the agent — see above. A solver is not.)
- Anti-cheat against anyone with filesystem or debugger access to the host machine.
