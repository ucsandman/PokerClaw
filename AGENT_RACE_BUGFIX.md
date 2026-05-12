# PokerClaw Agent Race Bugfix

## Problem

The live LLM agent works, but logs show repeated stale-action errors after successful actions:

```text
[agent] hand=2 street=preflop ... action=call posted
[agent] error: Not your turn.
[agent] error: Not your turn.
...
[agent] error: Hand is complete.
...
[agent] error: Cannot call.
...
[agent] hand=5 ... action=fold posted
[agent] hand=5 ... action=fold posted
```

This is almost certainly because `agent/index.ts` uses `setInterval()` while LLM decisions can take longer than the poll interval.

Current shape:

```ts
const timer = setInterval(() => {
  tick().catch(logError);
}, cfg.pollMs);
```

`tick()` is async. If the LLM call takes 2-5 seconds and polling is every 750ms, multiple `tick()` calls can run concurrently for the same decision spot. Since `lastDecisionKey` is only set after action post success, several in-flight ticks can all decide from the same stale state and then post duplicate or invalid actions.

The server correctly rejects these stale posts, but the agent should not be sending them.

---

## Fix Goals

1. No overlapping ticks.
2. No duplicate in-flight decisions for the same decision key.
3. Mark stale server rejections as non-fatal/noise-reduced.
4. Keep heartbeat behavior.
5. Preserve privacy rules and existing LLM/rules fallback behavior.

---

## Required Changes

### 1. Replace `setInterval` async overlap with sequential loop

Use a sequential async loop so only one tick runs at a time:

```ts
let stopped = false;

async function runLoop(): Promise<void> {
  while (!stopped) {
    const started = Date.now();
    await tick().catch(logError);
    const elapsed = Date.now() - started;
    await sleep(Math.max(0, cfg.pollMs - elapsed));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

runLoop().catch(logError);
```

On SIGINT:

```ts
stopped = true;
logInfo('agent stopped');
process.exit(0);
```

This alone should eliminate most errors.

### 2. Add an in-flight decision guard

Even with sequential loop, add belt-and-braces protection:

```ts
let inFlightDecisionKey: string | null = null;
```

Before LLM call:

```ts
if (key === lastDecisionKey || key === inFlightDecisionKey) return;
inFlightDecisionKey = key;
```

Then clear in `finally`:

```ts
finally {
  if (inFlightDecisionKey === key) inFlightDecisionKey = null;
}
```

### 3. Set consumed key before slow decision or immediately after post attempt as appropriate

Recommended:

- Set `inFlightDecisionKey = key` before deciding.
- Set `lastDecisionKey = key` after successful post or dry run.
- For stale server errors like `Not your turn.` or `Hand is complete.`, also set `lastDecisionKey = key` to suppress spam for that stale key.
- For transient network errors, do not set `lastDecisionKey`, so retry is possible.

Helper:

```ts
function isStaleActionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('Not your turn') ||
    msg.includes('Hand is complete') ||
    msg.includes('Cannot call') ||
    msg.includes('Cannot check') ||
    msg.includes('Cannot bet') ||
    msg.includes('Cannot raise');
}
```

For invalid action errors caused by stale LLM decision, suppress repeated retries for that key. Still log once.

### 4. Optional: fetch state after post for sanity

`client.postAction()` already returns a fresh `PlayerView`. Use it if helpful, but do not immediately act again inside the same tick.

---

## Tests to Add

Add tests around the loop logic if feasible, or extract a small `AgentRunner` class that is testable.

Minimum useful tests:

1. If a tick is already deciding, a second tick for the same key does not call strategy again.
2. Sequential loop does not overlap ticks when strategy is slow.
3. `Not your turn.` marks the decision key consumed/suppressed.
4. A network error does not mark the key consumed.
5. Successful post sets `lastDecisionKey`.

If extracting the runner is too much, add targeted unit tests for:

- `isStaleActionError()`
- decision-key guard behavior

---

## Acceptance Criteria

Run with LLM mode enabled and pollMs 750.

Expected logs:

```text
[agent] starting mode=match strategy=llm provider=anthropic ...
[agent] hand=2 street=preflop ... action=call posted
[agent] hand=2 street=flop ... action=check posted
```

No repeated spam like:

```text
[agent] error: Not your turn.
[agent] error: Not your turn.
[agent] error: Hand is complete.
```

A rare stale rejection can be logged once at debug/noise level, but it should not spam and should not result in duplicate posted actions.

Full gates:

```bash
npm test
npm run build
```

---

## Claude Code Prompt

Implement `AGENT_RACE_BUGFIX.md`.

Main fix: remove overlapping async `setInterval` behavior in `agent/index.ts`, add an in-flight decision guard, and suppress retries for stale decision errors. Preserve LLM/rules fallback behavior, heartbeat behavior, safe logging, and all privacy boundaries. Add tests where practical. Run `npm test` and `npm run build` before finishing.
