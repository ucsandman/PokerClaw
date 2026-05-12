# PokerClaw

Local heads-up no-limit Texas Hold'em where **you** play against an AI opponent in your browser.

One command, zero servers in the cloud, all the chips on the table.

```powershell
git clone https://github.com/ucsandman/PokerClaw.git
cd PokerClaw
npm install
python poker.py
```

The dealer, UI, and AI agent all run locally. The browser opens automatically when the table is ready.

Fake chips, local only. Not a gambling product.

---

## What is it

PokerClaw is a **trusted-server poker engine** with three interchangeable opponent strategies:

| Strategy | What you play against | Speed | Needs |
|---|---|---|---|
| **rules** (zero-config default) | A deterministic toy bot — good for learning the UI | Instant | nothing |
| **fast-live** | A real LLM making decisions on every spot, directly via API | 1–3s per decision | An Anthropic or OpenAI-compatible API key |
| **openclaw-bridge** | **Your own OpenClaw agent** with its own personality and identity | 10–30s per decision | An OpenClaw agent you've set up locally |

Out of the box `python poker.py` plays rules-mode against a generic rule bot. Add an API key to your `.env` to upgrade to fast-live. Configure an OpenClaw agent ID to play against your own custom bot — its name, emoji, theme, and avatar are pulled from OpenClaw automatically and shown in the UI.

Also includes:

- **Training mode** — capture a session of hands, then click *Review session* to have a coaching LLM analyze your play. The system prompt is grounded in Upswing Poker (Doug Polk, Fabian Adler) and Raise Your Edge (Bencb) concepts: button-open theory, polarized BB 3-bet construction, c-bet sizing by texture, river MDF discipline, and the 10 most common HU amateur leaks.
- **Strict privacy guardrails** — hole cards never leak through views, logs, or the review prompt. Opponent hole cards only appear in your review if they were shown at showdown.
- **Play again** — bust out and reset to a fresh stack with one click.
- Per-decision **source markers** and **latency** in agent logs so you can see exactly which path produced each action.

---

## Quickstart paths

### Zero-config: play against a rule bot

```powershell
git clone https://github.com/ucsandman/PokerClaw.git
cd PokerClaw
npm install
python poker.py
```

The browser opens at `http://localhost:5173` and you're playing. No keys, no setup. The bot plays a basic preflop range + bet/check by hand strength — good enough to learn the UI and verify the install.

### Upgrade to fast-live: real LLM opponent

1. Copy `.env.example` to `.env`:
   ```powershell
   cp .env.example .env
   ```
2. Get an API key from [Anthropic](https://console.anthropic.com/) (or any OpenAI-compatible endpoint).
3. Set in `.env`:
   ```dotenv
   POKERCLAW_AGENT_LLM_PROVIDER=anthropic
   POKERCLAW_AGENT_API_KEY=sk-ant-...
   POKERCLAW_AGENT_MODEL=claude-sonnet-4-6
   POKERCLAW_STRATEGY=fast-live
   ```
   For snappier responses (well under 3s per decision), set:
   ```dotenv
   POKERCLAW_FAST_MODEL=claude-haiku-4-5-20251001
   ```
4. Run `python poker.py`. The header badge will read `Fast · <model name>`.

### Bring your own OpenClaw agent

[OpenClaw](https://docs.openclaw.ai/) lets you stand up isolated AI agents with their own identity (name, emoji, theme, avatar) and personality. PokerClaw can play against any OpenClaw agent you've configured.

1. Create a dedicated agent (don't reuse your main one — game decisions would pollute its context):
   ```powershell
   openclaw agents add my-poker-bot
   openclaw agents set-identity --agent my-poker-bot --name "Ace" --emoji "🃏" --theme purple
   ```
2. Set in `.env`:
   ```dotenv
   POKERCLAW_STRATEGY=openclaw-bridge
   POKERCLAW_BRIDGE_LIVE_AGENT_ID=my-poker-bot
   POKERCLAW_AGENT_BRIDGE_SESSION_LABEL=my-poker-bot-session
   ```
3. Run `python poker.py`.

The launcher queries `openclaw agents list --json` at boot to pull your agent's name, emoji, theme, and avatar — the seat label, avatar tint, and status badge all reflect that identity automatically. No manual UI rebrand needed.

> **Why a dedicated agent?** OpenClaw agents accumulate session context. Playing thousands of poker hands against your main "personal assistant" agent would pollute it with poker chatter forever. A dedicated `*-poker` agent is safe to spin up, play against, and delete.

> **Seed your agent (optional).** If you want your agent to play in-character, send a one-time bootstrap message describing the rules + the JSON-only output contract before your first game. The launcher does this for the `moltfire-poker` agent automatically (see `poker.py`'s `BOOTSTRAP_TEXT`). For your own agent you can either edit `BOOTSTRAP_TEXT` or send the seed manually with `openclaw agent --agent my-poker-bot --session-id my-poker-bot-session --message "<your seed>"`.

---

## Training mode

Want to get better at heads-up? Hit **Start training** in the header, play 20-50 hands, hit **End training (N)**, then **Review session (N)**. A coaching LLM (defaults to your `POKERCLAW_AGENT_MODEL`) analyzes the session and returns a structured markdown review:

- **Headline** — the single biggest leak it sees
- **What you did well** — anchored to specific hand IDs
- **Most instructive spots** — 3-7 hands with action sequences, GTO-leaning recommendations, and opponent-adjustment notes
- **Pattern leaks** — recurring tendencies ranked by EV impact
- **Drills** — 2-3 things to focus on next session

The system prompt is built from public Upswing Poker and Raise Your Edge curriculum: 85% button-open default, polarized BB 3-bet ranges (premium value + offsuit bluffs that block but fold to 4-bets), c-bet small (25-40%) on dry boards and large (55-80%) on wet ones, double-barrel 66%+ on turns, river polarization, MDF discipline.

Hole-card privacy is enforced end-to-end: your cards are always shown to the reviewer (it's your study session); the opponent's hole cards are only included if shown at showdown.

---

## How it works

```
                 ┌─────────────┐
                 │  Browser    │  http://localhost:5173
                 │  (React UI) │
                 └──────┬──────┘
                        │  /api/*
                 ┌──────▼──────┐
                 │   Dealer    │  trusted server: game state, view scrubbing,
                 │ (Express)   │  training capture, review pipeline
                 └──────┬──────┘
                        │  /api/player/wes/state etc.
                 ┌──────▼──────┐
                 │  Agent      │  picks an action via the strategy chain:
                 │  (tsx)      │  shortcut → fast-live OR bridge → rules → safe
                 └──────┬──────┘
                        │  (only when openclaw-bridge mode)
                 ┌──────▼──────┐
                 │  Bridge     │  isolates OpenClaw — PokerClaw never imports
                 │  (Node)     │  OpenClaw internals; talks via local HTTP
                 └──────┬──────┘
                        │
                 ┌──────▼──────┐
                 │  OpenClaw   │  your dedicated poker agent
                 │  CLI        │
                 └─────────────┘
```

`python poker.py` supervises all of these as child processes, redacts hole-card patterns from unified log output, and cleans up cleanly on Ctrl+C.

Trust boundary: the dealer is the only thing that touches the deck. Every view served over HTTP runs through `viewForPlayer()` which strips opponent hole cards (unless shown at showdown), the full deck, and any future board cards. There's no way for the UI or the agent to peek.

---

## Configuration cheat sheet

| Var | Purpose | Default |
|---|---|---|
| `POKERCLAW_STRATEGY` | `rules` \| `fast-live` \| `openclaw-bridge` | `fast-live` (degrades to `rules` if no API key) |
| `POKERCLAW_AGENT_LLM_PROVIDER` | `anthropic` \| `openai-compatible` \| `off` | `off` |
| `POKERCLAW_AGENT_API_KEY` | API key for fast-live + reviewer | _(empty)_ |
| `POKERCLAW_AGENT_MODEL` | Default model id | _(empty)_ |
| `POKERCLAW_FAST_MODEL` | Override model for the fast-live path | falls back to `POKERCLAW_AGENT_MODEL` |
| `POKERCLAW_FAST_TIMEOUT_MS` | Hard cap on fast-live decisions | `5000` (capped at 5000) |
| `POKERCLAW_FAST_MAX_RETRIES` | Repair retries on invalid JSON | `1` (range 0-3) |
| `POKERCLAW_ENABLE_RULE_SHORTCUTS` | Cheap free-check shortcut layer | `1` |
| `POKERCLAW_BRIDGE_LIVE_AGENT_ID` | OpenClaw agent id to play against | `moltfire-poker` |
| `POKERCLAW_AGENT_BRIDGE_SESSION_LABEL` | Session id used with that agent | `moltfire-pokerclaw` |
| `POKERCLAW_OPPONENT_NAME` | Override displayed opponent name | auto-detected from OpenClaw, or strategy default |
| `POKERCLAW_OPPONENT_EMOJI` | Override displayed opponent emoji | auto-detected |
| `POKERCLAW_OPPONENT_THEME` | Override displayed opponent theme color | auto-detected |
| `POKERCLAW_OPPONENT_AVATAR` | URL or path to an avatar image | auto-detected |
| `POKERCLAW_REVIEW_MODEL` | Model for training reviews | falls back to `POKERCLAW_AGENT_MODEL` |
| `POKERCLAW_DISABLE_FALLBACK` | Strict mode for primary-path verification | unset |

See `.env.example` for the full list with explanations.

---

## Requirements

- **Node.js 20+**
- **Python 3.10+** (stdlib only)
- **OpenClaw CLI** _(only required for `openclaw-bridge` mode)_

---

## Development

```powershell
npm test            # 277 vitest tests
npm run build       # tsc --noEmit + vite production build
python tests/test_launcher.py  # 18 launcher tests

python poker.py          # full live boot
python poker.py dry      # bridge in dry-run mode
python poker.py teardown # kill leftover processes on the local ports
```

Architecture deep-dive: see [`ARCHITECTURE.md`](ARCHITECTURE.md). Privacy / fair-play contract: see [`FAIR_PLAY_PROTOCOL.md`](FAIR_PLAY_PROTOCOL.md). OpenClaw bridge wire format: see [`MOLTFIRE_OPENCLAW_BRIDGE.md`](MOLTFIRE_OPENCLAW_BRIDGE.md).

---

## License

This project is unlicensed by default. Open an issue if you'd like one.
