# Bridge CLI PATHEXT Resolution Fix

## Problem

When `poker.py` boots the bridge in live mode on Windows, every `/decide` call fails with:

```
[bridge] /decide error: cli-error:spawn openclaw ENOENT
```

The seed step from `poker.py` succeeded because the launcher invokes the CLI through `cmd.exe /c`, which applies `PATHEXT` and finds `openclaw.cmd`. The bridge sidecar calls `child_process.spawn('openclaw', argv)` directly. On Windows, Node's `spawn` does not honor `PATHEXT`, so `.cmd`, `.bat`, and `.ps1` shims are invisible. The agent never reaches MoltFire; it falls back to LLM (or rules) for every hand.

## Goal

Make the bridge's live-mode CLI invocation resolve `openclaw` (or whatever is in `POKERCLAW_BRIDGE_CLI_PATH`) the same way a shell would, without introducing `shell: true` or any new dependency.

## Hard requirements

- **No `shell: true`.** All argv stays as an array.
- **Cross-platform.** Linux/macOS users should keep working; this is a Windows-only resolution problem but the fix must not regress Unix.
- **No new npm dependency.** Use Node stdlib only.
- **Keep the existing main-agent refusal guard.** The fix changes how the CLI is located, not what it does.
- **Default behavior unchanged when `POKERCLAW_BRIDGE_CLI_PATH` is an absolute path.** Resolution only kicks in when the value is a bare command name (no path separators).

## Required behavior

In `bridge/moltfire-bridge.mjs` (or a small helper module like `bridge/resolve-cli.mjs`):

1. Read the configured CLI string. Default `openclaw`.
2. If the value contains a path separator (`/`, `\`) or starts with a drive letter, treat it as a literal path and pass it straight to `spawn`.
3. Otherwise, do a `PATHEXT`-aware lookup:
   - On Windows (`process.platform === 'win32'`), walk each entry in `process.env.PATH.split(';')` and for each entry, try the bare name plus each extension in `process.env.PATHEXT.split(';')` (typical default includes `.COM;.EXE;.BAT;.CMD`). Return the first match.
   - On other platforms, walk `process.env.PATH.split(':')` and return the first match with the executable bit set, or just the first existing file if mode can't be reliably checked.
4. If the lookup fails, throw a clear `cli-not-found` error so the HTTP handler returns 502 and the agent falls back to LLM. Log the searched name and a short hint about `POKERCLAW_BRIDGE_CLI_PATH`.
5. Cache the resolved path for the lifetime of the sidecar process to avoid disk hits on every decision. Recompute on SIGHUP if we ever wire one up; otherwise just cache.

## Tests

In `tests/bridge-cli-resolution.test.ts`:

1. Absolute path is returned unchanged.
2. Bare command with a known extension is resolved correctly on Windows (mock `PATH` + `PATHEXT` and a fake filesystem layer).
3. Bare command missing from PATH throws `cli-not-found`.
4. Resolution result is cached: second call does not re-scan PATH.
5. Path separator forms (`./openclaw`, `..\openclaw.cmd`) skip lookup and are passed through.

All existing tests must still pass.

## Manual verification

After the fix, in three PowerShell windows or via `python poker.py`:

```
cd C:\Projects\PokerClaw
python poker.py
```

Expected:

- Bridge banner unchanged.
- `[bridge] /decide ... (live) agent=moltfire-poker session=moltfire-pokerclaw` lines appear.
- `cli-error:spawn openclaw ENOENT` no longer appears.
- Agent banner reports `strategy=openclaw-bridge`.
- Hands play with actual MoltFire-shaped decisions, not the fast deterministic LLM fallback pattern.

## `/goal` prompt to paste into Claude Code

```text
/goal Implement BRIDGE_PATHEXT_FIX.md inside C:\Projects\PokerClaw. Add a PATHEXT-aware CLI resolver to the bridge sidecar so that on Windows, child_process.spawn can find openclaw.cmd / .bat / .exe shims without using shell:true. Use Node stdlib only, no new npm dependencies. Behavior: if POKERCLAW_BRIDGE_CLI_PATH contains a path separator or starts with a drive letter, pass it to spawn unchanged; otherwise walk process.env.PATH with process.env.PATHEXT on Windows, or PATH only on Unix, and return the first match. Cache the resolved path for the sidecar's lifetime. On lookup failure, throw cli-not-found so /decide returns 502 and the agent falls back to LLM. Keep the existing main-agent refusal guard intact. Add tests in tests/bridge-cli-resolution.test.ts covering absolute path passthrough, successful Windows lookup with mocked PATH/PATHEXT, lookup failure, caching, and path-separator passthrough. Run npm test and npm run build. Manually verify with `python poker.py` that bridge logs show `(live) agent=moltfire-poker session=moltfire-pokerclaw` and that `cli-error:spawn openclaw ENOENT` is gone. Stop only when all new tests pass, all existing 153+ tests still pass, npm run build passes, and a real hand against the live bridge completes without ENOENT errors. If genuinely blocked, document the exact blocker; do not weaken any safety rule.
```
