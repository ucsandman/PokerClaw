# /goal: Make PokerClaw Live Play Fast Enough to Be Fun

## Goal

Make `python poker.py` use a fast live decision path so Wes can actually play heads-up against MoltFire without waiting ~30 seconds per decision.

Current state:
- `python poker.py` now works end-to-end.
- The live OpenClaw bridge successfully calls `moltfire-poker` / `moltfire-pokerclaw`.
- Logs show decisions with `source=openclaw-bridge`.
- Problem: each decision takes roughly 30 seconds because every spot runs a full OpenClaw CLI agent turn.
- That is acceptable for proof-of-identity, but unplayable for a live poker game.

## Required Design

Add a fast live strategy path while preserving the existing OpenClaw bridge as a review/identity path.

Recommended strategy chain:

1. `fast-live` direct model path for ordinary live decisions.
2. `rules` shortcut for trivial/obvious decisions.
3. Optional `openclaw-bridge` only for review mode, tank mode, or explicit config.

The default live match should prioritize playability.

## Hard Requirements

1. Keep `python poker.py` as the one-command launcher.
2. Do not remove the working OpenClaw bridge.
3. Add a new fast strategy mode, probably named `fast-live` or `fast-llm`.
4. Default `python poker.py` should use the fast playable mode unless explicitly configured otherwise.
5. The fast path must call a model/API directly, not spawn `openclaw agent` per poker decision.
6. Keep localhost-only control flow.
7. Never log hole cards, API keys, bearer tokens, full prompts, or hidden state.
8. Keep action output strictly validated against legal actions.
9. If a fast model returns invalid output, retry once with a stricter repair prompt or fall back safely.
10. Logs must clearly show the source:
    - `source=fast-live`
    - `source=rules-shortcut`
    - `source=openclaw-bridge`
    - `source=fallback-rules`
11. Add latency logging per decision, e.g. `latencyMs=1430`.
12. Target ordinary decision latency under 3 seconds, with a hard timeout no higher than 5 seconds for the fast path.
13. Preserve `POKERCLAW_DISABLE_FALLBACK=1` behavior for verification.
14. No `shell:true` for subprocesses.
15. Do not use the main OpenClaw agent for live poker.

## Hybrid Decision Rules

Implement cheap shortcuts before calling any LLM:

- If legal action includes `check` and there is no bet to call, allow a quick rule-based check some percentage of the time or always in obvious low-pressure spots.
- If only one legal non-fold action exists and amount is zero, take it safely.
- Never auto-call large bets or all-ins purely by shortcut.
- Never auto-raise purely by shortcut unless explicitly configured.
- Use the fast model for meaningful decisions:
  - facing a bet
  - raise/call/fold spots
  - turn and river decisions
  - all-ins
  - unusually large pots

Keep shortcuts simple and testable. The goal is speed without making the bot feel brain-dead.

## Fast Model Prompt Contract

The fast model receives only MoltFire's legal game view and public action history. Do not include opponent hole cards or server-only hidden state.

It must return exactly compact JSON:

```json
{"action":"fold|check|call|raise","amount":0,"rationale":"short public rationale"}
```

Rules:
- No markdown.
- No explanation outside JSON.
- `amount` must be numeric.
- `action` must be legal for the current state.
- Raise amount must be within legal bounds.
- Rationale must not mention hidden/private cards beyond MoltFire's own private evaluation if logs are public. Prefer generic public rationale like `position and price`.

## Configuration

Add environment/config support for:

- `POKERCLAW_STRATEGY=fast-live|openclaw-bridge|rules`
- `POKERCLAW_FAST_MODEL=<model id>`
- `POKERCLAW_FAST_TIMEOUT_MS=5000`
- `POKERCLAW_FAST_MAX_RETRIES=1`
- `POKERCLAW_ENABLE_RULE_SHORTCUTS=1|0`
- existing OpenClaw bridge settings remain available for `openclaw-bridge` mode

Use sensible defaults that make `python poker.py` playable.

Recommended defaults:

- strategy: `fast-live`
- timeout: 5000ms
- retries: 1
- rule shortcuts: enabled

## UX / Launcher Requirements

When `python poker.py` starts, the banner must make the active strategy obvious.

Example:

```text
[agent] starting mode=match strategy=fast-live model=<model> fallback=rules pollMs=750 dryRun=false
```

If OpenClaw bridge mode is explicitly selected:

```text
[agent] starting mode=match strategy=openclaw-bridge sessionLabel=moltfire-pokerclaw ...
```

The launcher should not require Wes to remember multi-terminal commands.

## Tests Required

Add or update tests for:

1. Fast strategy returns a legal action from valid model JSON.
2. Invalid model action is rejected.
3. Invalid JSON triggers repair or safe fallback.
4. Fast strategy timeout falls back safely or waits when fallback disabled.
5. Rule shortcut checks when checking is legal and safe.
6. Rule shortcut does not call or raise into large bets.
7. Source markers are correct for fast, shortcut, OpenClaw bridge, and fallback.
8. Latency is logged without leaking secrets or hole cards.
9. `POKERCLAW_STRATEGY=openclaw-bridge` still works.
10. `POKERCLAW_DISABLE_FALLBACK=1` prevents hidden fallback actions.
11. Build still passes.

## Validation Commands

Run:

```powershell
npm test
npm run build
python .\poker.py
```

Then verify from real launcher logs:

- At least 5 live decisions complete.
- Most ordinary decisions are under 3 seconds.
- No decision exceeds the fast timeout unless using explicit OpenClaw bridge mode.
- Logs show `source=fast-live` or `source=rules-shortcut` in default live play.
- No accidental fallback hiding failures.
- `POKERCLAW_STRATEGY=openclaw-bridge python .\poker.py` still preserves the slower identity/review path.

## Acceptance Criteria

The goal is complete only when:

1. `python poker.py` launches everything with one command.
2. Default live play is fast enough to be playable.
3. At least 5 real MoltFire decisions are shown from the launcher path.
4. Median observed decision latency is under 3 seconds.
5. OpenClaw bridge mode still works when explicitly selected.
6. Source markers make it impossible to confuse fast path, shortcuts, OpenClaw bridge, and fallback.
7. Tests and build pass.
8. No secrets or hidden poker state are logged.

If any acceptance criterion cannot be met, do not claim success. Report the exact blocker and the relevant logs.

---

## Paste-ready `/goal` prompt

```text
/goal Make PokerClaw live play fast enough to be fun. Repo: C:\Projects\PokerClaw. Current state: `python poker.py` works end-to-end and OpenClaw bridge decisions succeed with `source=openclaw-bridge`, but each decision takes about 30 seconds because every spot spawns a full `openclaw agent` turn. Add a fast default live strategy while preserving the working OpenClaw bridge for review/tank/explicit mode.

Requirements: keep `python poker.py` as the one-command launcher. Add `POKERCLAW_STRATEGY=fast-live|openclaw-bridge|rules`, defaulting to `fast-live`. Fast-live must call a model/API directly, not spawn `openclaw agent` per decision. Add safe rule shortcuts before LLM calls for trivial checks/zero-cost obvious spots, but never auto-call large bets/all-ins or auto-raise purely by shortcut. Keep localhost-only flow. Never log hole cards, API keys, bearer tokens, full prompts, or hidden state. Validate every action against legal actions and amount bounds. If fast model output is invalid, retry once or fall back safely. Preserve `POKERCLAW_DISABLE_FALLBACK=1`.

Fast model must return only compact JSON: {"action":"fold|check|call|raise","amount":0,"rationale":"short public rationale"}. No markdown or extra text. Add source and latency logs: `source=fast-live`, `source=rules-shortcut`, `source=openclaw-bridge`, or `source=fallback-rules`, plus `latencyMs=<n>`. Target ordinary decisions under 3 seconds and fast path timeout <= 5000ms. Keep `openclaw-bridge` mode working when explicitly selected.

Tests required: fast valid JSON -> legal action; invalid action rejected; malformed JSON repair/fallback; fast timeout behavior with fallback enabled/disabled; shortcut check behavior; shortcut does not call/raise into large bets; correct source markers; latency logging redacts secrets/hole cards; `POKERCLAW_STRATEGY=openclaw-bridge` still works; build passes.

Validation: run `npm test`, `npm run build`, and real launcher `python .\poker.py`. Acceptance: at least 5 real launcher-path decisions, median latency under 3 seconds, logs show `source=fast-live` or `source=rules-shortcut` by default, explicit `POKERCLAW_STRATEGY=openclaw-bridge` still works, no hidden fallback confusion, no secret/hidden-state leakage. If any criterion cannot be met, do not claim success; report blocker and logs.
```
