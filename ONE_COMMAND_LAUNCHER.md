# PokerClaw One-Command Launcher (`poker.py`)

## Why this exists

Right now playing MoltFire requires:

1. A separate terminal for the dealer + Vite (`npm run dev`).
2. A separate terminal for the bridge (`npm run bridge`).
3. A separate terminal for the agent with three env vars set.
4. A one-time bootstrap message to `moltfire-poker` via `openclaw agent ...` with hand-quoted JSON.
5. Opening the browser.

Wes is sick of typing all that. One command needs to do all of it.

## Goal

Ship a single launcher at `C:\Projects\PokerClaw\poker.py` (Python 3, no extra deps beyond the stdlib) that:

1. Verifies prerequisites (Node version, ports free, OpenClaw CLI on PATH, `moltfire-poker` agent registered).
2. Spawns the dealer + UI (`npm run dev`), the bridge in live mode (`npm run bridge`), and the live agent (`npm run agent`) as supervised child processes with prefixed log output.
3. Detects "first run" and seeds the `moltfire-pokerclaw` session with the bootstrap message automatically. Re-running the launcher does not re-seed.
4. Waits for the dealer to be ready (`GET http://127.0.0.1:3001/api/player/wes/state`), then opens `http://localhost:5173/` in the default browser.
5. Streams unified logs to stdout, redacting any 2-char hole-card pattern (`[2-9TJQKA][cdhs]`) as a defense-in-depth, even though the bridge already suppresses them.
6. On Ctrl+C, terminates all child processes cleanly.
7. Exits non-zero if any required child crashes during startup; otherwise logs and continues.

A second mode `python poker.py dry` runs the same flow but uses the dry-run bridge (`npm run bridge:dry-run`) and skips the bootstrap step. Useful for testing without burning OpenClaw tokens.

A third mode `python poker.py teardown` kills any leftover processes on the three ports and exits.

## Hard requirements

- **No new external dependencies.** Python 3.10+ stdlib only.
- **Windows-first.** Must work in PowerShell from `C:\Projects\PokerClaw`. WSL/Linux/macOS compatibility is nice-to-have but not blocking.
- **No `shell=True` anywhere.** Every subprocess invocation uses `subprocess.Popen([...])` with an argv list. Same rule the live bridge already enforces.
- **No secrets baked into the launcher.** It reads env from the existing `.env` if present (using a tiny inline loader, no `python-dotenv` dependency).
- **No hole cards in logs.** Implement the regex redaction in the log pump.
- **Bootstrap seed only sends on first run.** Tracked via a sentinel file at `C:\Projects\PokerClaw\.poker-seeded`. The contents include the date and the SHA-256 of the bootstrap text used, so a future seed-text change forces a re-seed automatically.
- **Refuse to spawn the bridge against `--agent main`.** Mirror the same guard the bridge itself already enforces.
- **Health-check timeouts** are short and explicit. Dealer must be reachable within 30 seconds or the launcher aborts and tears everything down.

## Bootstrap text

The launcher should hold the bootstrap text as a triple-quoted Python string (not shelled-out). The string is:

```
You are MoltFire (Poker), the isolated PokerClaw opponent for Wes.
Load context from:
  - C:\Users\sandm\clawd\SOUL.md
  - C:\Users\sandm\clawd\MOLTFIRE_CONSTITUTION.md
  - C:\Projects\PokerClaw\FAIR_PLAY_PROTOCOL.md
From here on, every PokerClaw decision request you receive must reply with strict JSON only:
{ "action": { ... }, "rationale": "<one-line public-safe rationale>" }
No chain of thought. Never reveal hole cards in chat. Match Mode is the default.
Acknowledge with a single JSON object: { "ready": true }.
```

The launcher sends this via:

```
openclaw agent --agent moltfire-poker --session-id moltfire-pokerclaw --message <bootstrap> --json --timeout 60
```

It passes `<bootstrap>` as a single argv element to avoid PowerShell quoting issues.

The launcher parses the JSON reply. If `ready` is not true, it logs a warning but continues — the dedicated session is still usable; the seed just may need a retry.

## Default env injected by the launcher

If the user did not set these, the launcher sets them in the child process environment only (not in the parent shell):

```
POKERCLAW_AGENT_BRIDGE_ENABLED=true
POKERCLAW_AGENT_BRIDGE_URL=http://127.0.0.1:5179
POKERCLAW_AGENT_BRIDGE_SESSION_LABEL=moltfire-pokerclaw
POKERCLAW_BRIDGE_LIVE_AGENT_ID=moltfire-poker
POKERCLAW_BRIDGE_LIVE_MODEL=anthropic/claude-sonnet-4-6
POKERCLAW_BRIDGE_LIVE_TIMEOUT_SEC=30
```

Existing user env always wins.

## Output shape

Logs are prefixed and color-tagged (ANSI is fine):

```
[dealer]  PokerClaw dealer listening on http://localhost:3001
[ui]      VITE v5.4.21 ready in 588 ms
[bridge]  listening http://127.0.0.1:5179 mode=live sessionLabel=moltfire-pokerclaw
[agent]   starting mode=match strategy=openclaw-bridge ...
[launcher] dealer ready, opening http://localhost:5173
```

## Tests

Add a `tests/test_launcher.py` (Python `unittest`, stdlib only):

1. `redact_hole_cards("[bridge] holeCards=AhKd 2c")` returns the input with each rank+suit pair replaced by `??`.
2. `bootstrap_sha256` is deterministic for the canonical bootstrap text and changes when the text changes.
3. `should_reseed` returns True when sentinel is missing, when sentinel SHA differs, and when `--force-seed` is passed; returns False otherwise.
4. `validate_agent_id` rejects `main` and accepts `moltfire-poker`.
5. The launcher's port-precheck function returns False when a test socket occupies the port, True otherwise.

Existing PokerClaw tests must still pass (`npm test`, `npm run build`).

## Acceptance criteria

Stop only when all of these hold:

1. `python poker.py` boots dealer + ui + bridge + agent + browser in one command.
2. First run seeds `moltfire-pokerclaw`; subsequent runs skip the seed.
3. `python poker.py dry` runs in dry-run mode without contacting OpenClaw.
4. `python poker.py teardown` kills leftover processes.
5. Ctrl+C cleanly stops every child.
6. Hole-card strings are absent from launcher stdout even when synthetic.
7. Launcher refuses to spawn the bridge against `--agent main`.
8. `python tests/test_launcher.py` passes (or `pytest tests/test_launcher.py` if pytest is already present).
9. `npm test` and `npm run build` still pass.
10. README updated with a top section: "Quickstart: `python poker.py`".

If a Windows-specific issue blocks part of this, document the exact issue and ship the rest. Do not weaken any safety rule to chase coverage.

## `/goal` prompt to paste into Claude Code

```text
/goal Implement ONE_COMMAND_LAUNCHER.md inside C:\Projects\PokerClaw. Ship a Python 3.10+ stdlib-only launcher at C:\Projects\PokerClaw\poker.py that boots the PokerClaw dealer+UI (npm run dev), the bridge in live mode (npm run bridge), and the live agent (npm run agent) as supervised child processes with prefixed unified logs; on first run, also seeds the dedicated isolated session by spawning `openclaw agent --agent moltfire-poker --session-id moltfire-pokerclaw --message <bootstrap> --json --timeout 60` with the bootstrap text passed as a single argv element; tracks first-run via a `.poker-seeded` sentinel that stores the SHA-256 of the bootstrap text so changes force a re-seed; opens http://localhost:5173 after the dealer health check passes; redacts any `[2-9TJQKA][cdhs]` pattern from launcher stdout; supports `python poker.py dry` (uses npm run bridge:dry-run and skips seeding) and `python poker.py teardown` (kills leftover processes on the three ports); injects default bridge env (POKERCLAW_AGENT_BRIDGE_ENABLED=true, POKERCLAW_AGENT_BRIDGE_URL=http://127.0.0.1:5179, POKERCLAW_AGENT_BRIDGE_SESSION_LABEL=moltfire-pokerclaw, POKERCLAW_BRIDGE_LIVE_AGENT_ID=moltfire-poker, POKERCLAW_BRIDGE_LIVE_MODEL=anthropic/claude-sonnet-4-6, POKERCLAW_BRIDGE_LIVE_TIMEOUT_SEC=30) only when not already set in the user shell; uses subprocess.Popen with argv lists exclusively (never shell=True); refuses to spawn the bridge against agentId=main even if env is misconfigured; cleanly terminates every child on Ctrl+C. Add tests/test_launcher.py covering redact_hole_cards, bootstrap_sha256 determinism, should_reseed, validate_agent_id rejecting main, and port-precheck. Update README with a top-of-file "Quickstart: python poker.py" section that documents the launcher, the dry mode, and the teardown mode. Stop only when python poker.py boots everything end to end with one command, first-run seeding works, subsequent runs skip seeding, dry mode works without OpenClaw, teardown cleans up leftover processes, Ctrl+C terminates every child cleanly, no hole-card strings appear in launcher stdout in any mode, the launcher refuses --agent main, all new launcher tests pass, all existing npm test (153) pass, and npm run build passes. If a real Windows-specific issue blocks one mode, document the exact blocker and ship the rest without weakening any safety rule.
```
