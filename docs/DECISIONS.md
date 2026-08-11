# Decision log


---

# Recovered decisions (claude-mem archive)

9 decisions recovered 2026-08-11 from the claude-mem store before it was pruned. Source window 2026-04-06 to 2026-06-11. Full archive with observations and session summaries: `C:\Projectsrchives\claude-mem-2026-08-11\`.

## 2026-05-12 — PokerClaw project broken into 5-phase implementation plan

Task list created covering scaffold, engine, server, UI, and test suite for heads-up poker app

- Task 1 covers project scaffolding with package.json, tsconfig, vite, and gitignore
- Task 2 builds shared TypeScript poker engine with cards, deck, types, actions, game logic, evaluator, and view-models
- Task 3 implements Express server with separate authorized endpoints for Wes and MoltFire
- Task 4 builds React UI with Vite including Table, PlayerSeat, Board, ActionPanel, and HandHistory components
- Task 5 writes Vitest test suite covering deck integrity, privacy guarantees, legal-actions validation, betting rounds, showdown logic, and hand evaluator

## 2026-05-12 — Live Agent Architecture for PokerClaw Autonomous Poker AI

Designed polling-based autonomous agent to transform turn-based MoltFire AI into real-time poker opponent with fair-play privacy

- MoltFire poker AI currently operates turn-based through Telegram requiring manual user prompts for each action
- Polling agent architecture selected as fastest MVP polls /api/ai/state every 500-750ms and posts actions to /api/ai/action
- Fair-play protocol enforces agent only consumes authorized MoltFire state view without accessing server internals or opponent hole cards
- Duplicate action protection implemented via decision key combining handId, street, actionCount, currentActor, currentBet, and pot fields
- Agent runs as independent Node process communicating only through public HTTP APIs to enforce privacy boundaries
- Three strategy levels defined: Level 0 rule-based toy bot, Level 1 LLM poker agent, Level 2 hybrid heuristics with LLM
- LLM decision latency target set under 3 seconds with Match Mode requiring no hole card logging to prevent information leakage
- Five-milestone build plan covers agent client, rule-based strategy, LLM integration, scripts/docs, and UI status indicators

## 2026-05-12 — PokerClaw UI polish and tournament system implementation breakdown

Feature decomposed into six sequential tasks covering blinds engine, integration, view model, UI styling, and betting UX

- Task 16 creates shared/blinds.ts with 8-level hand-count-based tournament schedule and vitest coverage
- Task 17 wires blind schedule into game engine, replacing static SB/BB env vars with dynamic per-hand lookup
- Task 18 extends PlayerView with tournament info and agent status tracking via /api/agent/status endpoint
- Task 19 implements ClubGG-inspired visual polish with oval felt, pot pill, dealer button chip, and BB stack display
- Task 20 refactors ActionPanel with preflop BB-multiplier presets (2.2x/2.5x/3x) and postflop pot-percentage presets (33%/50%/75%/pot/max)
- Task 21 polishes HandHistory with street grouping and pot sizes, adds agent status indicator for MoltFire thinking/LLM mode/offline states

## 2026-05-12 — Removed default model injection from launcher due to OpenClaw authorization

POKERCLAW_BRIDGE_LIVE_MODEL no longer defaulted; OpenClaw requires explicit authorization for model overrides

- Launcher no longer injects POKERCLAW_BRIDGE_LIVE_MODEL into child process environment
- OpenClaw rejects --model overrides unless the caller is explicitly authorized
- Operators with override authority can set anthropic/claude-sonnet-4-6 in shell or .env
- POKERCLAW_BRIDGE_LIVE_TIMEOUT_SEC default increased from 30 to 180 seconds
- README.md quickstart section updated to document the deliberate omission

Files: `README.md`

## 2026-05-12 — Implementation plan creates separate fast-live strategy with shortcut layer and explicit POKERCLAW_STRATEGY selection

Eight-task plan creates new fast-live.ts and rule-shortcut.ts strategies instead of renaming existing LLM infrastructure

- Task plan creates new agent/strategy/fast-live.ts for direct model calls rather than repurposing existing agent/strategy/llm
- Plan adds agent/strategy/rule-shortcut.ts for trivial zero-cost decisions before LLM calls, never auto-calling large bets or auto-raising
- POKERCLAW_STRATEGY environment variable becomes primary config with values fast-live|openclaw-bridge|rules, defaulting to fast-live
- New config variables include POKERCLAW_FAST_MODEL, POKERCLAW_FAST_TIMEOUT_MS, POKERCLAW_FAST_MAX_RETRIES, POKERCLAW_ENABLE_RULE_SHORTCUTS
- Strategy chain composition varies by mode: fast-live uses shortcut→fast-live→rules→safe; openclaw-bridge uses bridge→shortcut→fast-live→rules→safe
- Latency tracking added with latencyMs=<n> logging and source markers distinguishing fast-live, rules-shortcut, openclaw-bridge, fallback-rules
- poker.py launcher modified to stop forcing bridge enabled by default, instead defaulting to POKERCLAW_STRATEGY=fast-live
- Test coverage includes fast-live JSON validation/retry/timeout, shortcut gating rules, and updated banner tests for new strategy modes

## 2026-05-12 — Designed Training Session State Architecture

Training mode will capture hand snapshots via Session state with start/end methods and action hooks

- Training state management will be added to server/state.ts Session class
- Training API includes startTraining(), endTraining() returning snapshots, isTrainingActive(), and trainingCount() methods
- applyPlayerAction will be hooked to snapshot each hand on completion during training
- HandSnapshot structure includes hole cards with privacy rules, board state, action history, and hand result
- endTraining() returns all collected hand snapshots for review analysis

## 2026-05-12 — Designed Complete Training Mode Architecture Across All Layers

Four-layer architecture spanning state management, AI review module, REST API, and UI components

- Review module at review/index.ts will format HandSnapshot arrays into coaching text and build HUNL coaching system prompt using Upswing/RYE concepts
- Reviewer calls Anthropic API to generate markdown review from professional poker strategy knowledge
- Three REST API endpoints expose training functionality: POST /api/training/start, POST /api/training/end returning hand count and snapshots, POST /api/training/review returning markdown
- TrainingControl UI component in App.tsx provides header toggle button, hand count pill indicator, and modal for displaying markdown review
- Training status surfaces in PlayerView to show active training state during gameplay

## 2026-05-12 — Dynamic opponent profile system to replace hardcoded MoltFire identity

OpponentProfile type will fetch agent identity from OpenClaw CLI for configurable multi-user gameplay

- New OpponentProfile type will include: name, emoji, theme, avatarUrl, and source fields
- Server resolves opponent profile from environment variables with per-strategy defaults
- Three strategy modes planned: rules, fast-live, and openclaw-bridge
- Launcher (poker.py) will execute "openclaw agents list --json" when strategy=openclaw-bridge
- Agent identity will populate POKERCLAW_OPPONENT_NAME/EMOJI/THEME/AVATAR environment variables
- Currently MoltFire identity is hardcoded in 5 React components

## 2026-05-12 — Three gameplay modes planned for multi-user deployment

Rules mode (zero config), fast-live (Anthropic API), and openclaw-bridge (custom agents) for different user scenarios

- Rules mode provides zero-configuration gameplay with rule-based opponent AI
- Fast-live mode requires Anthropic API key for AI-powered opponent
- Openclaw-bridge mode lets users play against their own configured OpenClaw agents
- UI refactor will replace all hardcoded "MoltFire" references with dynamic OpponentProfile fields
- OpponentProfile resolution will have server-side tests for env overrides, strategy fallbacks, and identity parsing
- README rewrite targets new users with quickstart guides for each mode

