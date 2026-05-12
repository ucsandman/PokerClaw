#!/usr/bin/env python3
"""PokerClaw one-command launcher.

Boots the dealer+UI (`npm run dev`), the bridge in live mode (`npm run bridge`),
and the live agent (`npm run agent`) as supervised child processes; redacts
any hole-card pattern from unified launcher stdout; on first run seeds the
dedicated `moltfire-pokerclaw` OpenClaw session; opens the UI in the browser
once the dealer is healthy; cleans up every child on Ctrl+C.

Stdlib-only, Python 3.10+. `subprocess.Popen` with argv lists exclusively;
`shell=True` is never used anywhere.

Usage:
    python poker.py                 # full live boot
    python poker.py dry             # uses bridge:dry-run, skips seeding
    python poker.py teardown        # kills leftover processes on dealer/UI/bridge ports
    python poker.py --force-seed    # re-send the bootstrap seed even if sentinel matches
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

# Force UTF-8 stdout on Windows consoles (default cp1252 mangles em-dashes and
# the ANSI prefix glyphs). reconfigure() is a no-op on streams that already
# decode in UTF-8, so it's safe everywhere.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except (AttributeError, OSError):
    pass

# ----------------------------------------------------------------------------
# Constants — fixed surface tested by tests/test_launcher.py.
# ----------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent
SENTINEL_PATH = PROJECT_ROOT / ".poker-seeded"

DEALER_PORT = 3001
UI_PORT = 5173
BRIDGE_PORT = 5179
DEALER_HEALTH_URL = f"http://127.0.0.1:{DEALER_PORT}/api/player/wes/state"
UI_URL = f"http://localhost:{UI_PORT}/"

# The bridge already enforces this list. We mirror it here so the launcher
# refuses to spawn the bridge with a misconfigured POKERCLAW_BRIDGE_LIVE_AGENT_ID.
BANNED_AGENT_IDS = frozenset(
    {"main", "default", "primary", "moltfire", "moltfire-main"}
)
ALLOWED_AGENT_ID = "moltfire-poker"
SESSION_LABEL = "moltfire-pokerclaw"

# Default env injected ONLY when the user shell did not already set it.
#
# `fast-live` is the playable default: direct model call per decision,
# 5s timeout, rule shortcuts on, no OpenClaw bridge. Operators who want
# review/tank/identity mode set POKERCLAW_STRATEGY=openclaw-bridge in
# their shell or .env — DEFAULT_BRIDGE_ENV then layers the bridge env on
# top (we still include those defaults here so explicit bridge mode boots
# without further config).
#
# Note: we intentionally do NOT set POKERCLAW_BRIDGE_LIVE_MODEL by default.
# OpenClaw rejects `--model` overrides with `GatewayClientRequestError:
# provider/model overrides are not authorized for this caller` unless the
# caller has been granted override authority. Operators with that grant can
# set it explicitly in their shell or .env.
DEFAULT_FAST_LIVE_ENV: dict[str, str] = {
    "POKERCLAW_STRATEGY": "fast-live",
    "POKERCLAW_FAST_TIMEOUT_MS": "5000",
    "POKERCLAW_FAST_MAX_RETRIES": "1",
    "POKERCLAW_ENABLE_RULE_SHORTCUTS": "1",
}

DEFAULT_BRIDGE_ENV: dict[str, str] = {
    "POKERCLAW_AGENT_BRIDGE_URL": f"http://127.0.0.1:{BRIDGE_PORT}",
    "POKERCLAW_AGENT_BRIDGE_SESSION_LABEL": SESSION_LABEL,
    "POKERCLAW_BRIDGE_LIVE_AGENT_ID": ALLOWED_AGENT_ID,
    # 180s default: covers OpenClaw's embedded-agent fallback path (gateway
    # daemon unreachable). When the gateway service is healthy, calls return
    # well under 10s; when it's down OpenClaw spawns the full embedded agent
    # which has to re-load skills on each call (~2 minutes cold). Operators
    # with a healthy gateway can lower this in .env.
    "POKERCLAW_BRIDGE_LIVE_TIMEOUT_SEC": "180",
}

# Triple-quoted bootstrap (canonical, do not edit unless you intend to force a
# re-seed on every developer's machine — the SHA-256 of this string is what the
# sentinel pins).
BOOTSTRAP_TEXT = (
    "You are MoltFire (Poker), the isolated PokerClaw opponent for Wes.\n"
    "Load context from:\n"
    "  - C:\\Users\\sandm\\clawd\\SOUL.md\n"
    "  - C:\\Users\\sandm\\clawd\\MOLTFIRE_CONSTITUTION.md\n"
    "  - C:\\Projects\\PokerClaw\\FAIR_PLAY_PROTOCOL.md\n"
    "From here on, every PokerClaw decision request you receive must reply with strict JSON only:\n"
    '{ "action": { ... }, "rationale": "<one-line public-safe rationale>" }\n'
    "No chain of thought. Never reveal hole cards in chat. Match Mode is the default.\n"
    'Acknowledge with a single JSON object: { "ready": true }.\n'
)

# ANSI color codes — keep tiny, no external dep.
_PREFIX_COLORS = {
    "dealer": "\x1b[34m",  # blue
    "ui": "\x1b[32m",  # green
    "bridge": "\x1b[35m",  # magenta
    "agent": "\x1b[36m",  # cyan
    "launcher": "\x1b[33m",  # yellow
}
_RESET = "\x1b[0m"
_USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") in (None, "")


# ----------------------------------------------------------------------------
# Pure helpers — covered by tests/test_launcher.py.
# ----------------------------------------------------------------------------

# Defense-in-depth redaction. The bridge already suppresses hole-card logging,
# but the launcher reads child stdout/stderr unfiltered, so any future logger
# in the dealer/bridge/agent that accidentally prints a card pair is scrubbed
# before it reaches the user's terminal.
_HOLE_CARD_RE = re.compile(r"[2-9TJQKA][cdhs]")


def redact_hole_cards(text: str) -> str:
    """Replace every `[2-9TJQKA][cdhs]` rank+suit pair with `??`.

    Case-sensitive on the rank letter — lowercase ranks are not valid card
    syntax and stay untouched.
    """
    return _HOLE_CARD_RE.sub("??", text)


def bootstrap_sha256(text: str) -> str:
    """SHA-256 hex of the bootstrap text. Determinism is the contract."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def should_reseed(sentinel: Path, current_sha: str, force: bool) -> bool:
    """True when the sentinel is missing, malformed, has a stale SHA, or `force` is set."""
    if force:
        return True
    if not sentinel.exists():
        return True
    try:
        body = sentinel.read_text(encoding="utf-8")
    except OSError:
        return True
    for raw in body.splitlines():
        line = raw.strip()
        if line.startswith("sha256="):
            return line.split("=", 1)[1].strip() != current_sha
    return True


def validate_agent_id(value: object) -> str:
    """Mirror the bridge's banned-id guard. Returns trimmed value or raises ValueError."""
    if not isinstance(value, str):
        raise ValueError("agent-id-not-string")
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("agent-id-empty")
    if trimmed.lower() in BANNED_AGENT_IDS:
        raise ValueError(f"agent-id-banned:{trimmed}")
    return trimmed


def is_port_free(port: int, host: str = "127.0.0.1") -> bool:
    """True when nothing is listening on (host, port), False otherwise."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((host, port))
    except OSError:
        return False
    finally:
        sock.close()
    return True


# ----------------------------------------------------------------------------
# Logging — prefixed, color-tagged, redacted at the membrane.
# ----------------------------------------------------------------------------

_log_lock = threading.Lock()


def log(prefix: str, message: str) -> None:
    """Print one prefixed, redacted line to stdout. Thread-safe."""
    clean = redact_hole_cards(message)
    if _USE_COLOR:
        color = _PREFIX_COLORS.get(prefix, "")
        line = f"{color}[{prefix:<8}]{_RESET} {clean}"
    else:
        line = f"[{prefix:<8}] {clean}"
    with _log_lock:
        print(line, flush=True)


def _pump(prefix: str, stream, stop_event: threading.Event) -> None:
    """Read a child stream line by line, redact, and log."""
    try:
        for raw in iter(stream.readline, b""):
            if stop_event.is_set() and not raw:
                break
            try:
                text = raw.decode("utf-8", errors="replace").rstrip("\r\n")
            except Exception:
                continue
            if not text:
                continue
            log(prefix, text)
    finally:
        try:
            stream.close()
        except Exception:
            pass


# ----------------------------------------------------------------------------
# .env loader — read PROJECT_ROOT/.env into a dict without overriding os.environ.
# ----------------------------------------------------------------------------


def load_dotenv(path: Path) -> dict[str, str]:
    """Return a dict of KEY=VALUE pairs from a `.env` file. No expansion, no overrides."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    try:
        body = path.read_text(encoding="utf-8")
    except OSError:
        return out
    for raw in body.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if val.startswith('"') and val.endswith('"') and len(val) >= 2:
            val = val[1:-1]
        elif val.startswith("'") and val.endswith("'") and len(val) >= 2:
            val = val[1:-1]
        if key:
            out[key] = val
    return out


def build_child_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """Compose the env passed to child processes.

    Layering (each step only fills keys the previous one did NOT set):
      1. os.environ — anything the operator's shell already exported.
      2. PROJECT_ROOT/.env — declared overrides for this checkout.
      3. DEFAULT_FAST_LIVE_ENV — strategy=fast-live + sane fast-path defaults.
      4. DEFAULT_BRIDGE_ENV — bridge endpoint/agent-id/timeout (used only when
         strategy=openclaw-bridge; harmless when fast-live since the agent
         only consults the bridge envs when POKERCLAW_AGENT_BRIDGE_ENABLED=true).
      5. Strategy-conditional bridge enable:
            - strategy=openclaw-bridge → POKERCLAW_AGENT_BRIDGE_ENABLED=true
              (unless the operator already set it).
            - any other strategy        → POKERCLAW_AGENT_BRIDGE_ENABLED is
              left untouched. Default unset == disabled in agent/config.ts.
      6. `extra` overrides everything (callers asserting deliberate intent).
    """
    merged = dict(os.environ)
    dotenv = load_dotenv(PROJECT_ROOT / ".env")
    for k, v in dotenv.items():
        merged.setdefault(k, v)
    for k, v in DEFAULT_FAST_LIVE_ENV.items():
        merged.setdefault(k, v)
    for k, v in DEFAULT_BRIDGE_ENV.items():
        merged.setdefault(k, v)
    if (
        merged.get("POKERCLAW_STRATEGY", "fast-live").strip().lower()
        == "openclaw-bridge"
    ):
        merged.setdefault("POKERCLAW_AGENT_BRIDGE_ENABLED", "true")
    if extra:
        merged.update(extra)
    return merged


# ----------------------------------------------------------------------------
# Spawn helpers — argv lists, never shell=True.
# ----------------------------------------------------------------------------


def _npm_argv(script: str) -> list[str]:
    """Return the argv to run `npm run <script>` without shell=True.

    On Windows, npm ships as `npm.cmd`. CreateProcessW cannot execute `.cmd`
    files directly, so we invoke it through `cmd.exe /c npm run <script>`.
    `shell=False` still holds — Python does not interpret any shell
    metacharacters; cmd.exe simply re-executes its explicit argv tail.
    """
    if os.name == "nt":
        return ["cmd.exe", "/c", "npm", "run", script]
    return ["npm", "run", script]


def _resolve_openclaw_argv(
    message: str, agent_id: str, session_label: str, timeout_sec: int
) -> list[str]:
    """Build the argv for the one-shot OpenClaw seed call.

    Bypasses the openclaw.cmd shim on Windows by reading it to find the
    underlying `node openclaw.mjs` invocation, then spawns node directly with
    the script + argv. That way the bootstrap text (which contains JSON-quoted
    `<`, `>`, `"` characters) is delivered verbatim to OpenClaw's argv without
    a second cmd.exe re-parse.
    """
    validate_agent_id(agent_id)  # raises if agent_id is banned
    shim = shutil.which("openclaw")
    if shim is None:
        raise RuntimeError("openclaw CLI not found on PATH")

    common = [
        "agent",
        "--agent",
        agent_id,
        "--session-id",
        session_label,
        "--message",
        message,
        "--json",
        "--timeout",
        str(timeout_sec),
    ]

    if os.name != "nt":
        return [shim, *common]

    # Windows: try to bypass the .cmd shim → spawn node directly.
    shim_path = Path(shim)
    if shim_path.suffix.lower() == ".cmd":
        try:
            shim_body = shim_path.read_text(encoding="utf-8", errors="replace")
            mjs_match = re.search(r'"([^"]+\.m?js)"', shim_body)
            if mjs_match:
                mjs_rel = (
                    mjs_match.group(1)
                    .replace("%dp0%", str(shim_path.parent))
                    .replace("\\\\", "\\")
                )
                mjs_path = Path(mjs_rel)
                if mjs_path.is_file():
                    node_exe = shutil.which("node") or "node"
                    return [node_exe, str(mjs_path), *common]
        except OSError:
            pass

    # Fallback: invoke through cmd.exe /c. cmd.exe's re-parsing may garble the
    # bootstrap message if it contains shell-special chars; we accept the risk
    # only when we cannot resolve the .mjs.
    return ["cmd.exe", "/c", "openclaw", *common]


# ----------------------------------------------------------------------------
# Health / port helpers.
# ----------------------------------------------------------------------------


def wait_for_dealer(timeout_sec: int = 30) -> bool:
    """Poll the dealer state endpoint until 200 OK or timeout."""
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(DEALER_HEALTH_URL, timeout=2) as resp:
                if 200 <= resp.status < 300:
                    return True
        except (
            urllib.error.URLError,
            urllib.error.HTTPError,
            ConnectionError,
            TimeoutError,
            OSError,
        ):
            pass
        time.sleep(0.5)
    return False


def precheck_ports(include_bridge: bool = True) -> list[int]:
    """Return the list of expected-free ports that are actually busy.

    `include_bridge=False` skips the bridge port — used when the launcher
    decides not to spawn the bridge subprocess (fast-live strategy) and so
    has no opinion on whether the bridge port is free.
    """
    busy: list[int] = []
    ports = (
        (DEALER_PORT, UI_PORT, BRIDGE_PORT)
        if include_bridge
        else (DEALER_PORT, UI_PORT)
    )
    for port in ports:
        if not is_port_free(port):
            busy.append(port)
    return busy


# ----------------------------------------------------------------------------
# Teardown — kill leftover processes on the three ports.
# ----------------------------------------------------------------------------


def _windows_pids_on_port(port: int) -> list[int]:
    """Parse `netstat -ano` LISTENING rows for the given TCP port."""
    try:
        result = subprocess.run(
            ["netstat", "-ano", "-p", "TCP"],
            capture_output=True,
            text=True,
            shell=False,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    pids: set[int] = set()
    target = f":{port}"
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        if parts[0] != "TCP":
            continue
        if parts[3].upper() != "LISTENING":
            continue
        if not parts[1].endswith(target):
            continue
        try:
            pids.add(int(parts[4]))
        except ValueError:
            continue
    return sorted(pids)


def _posix_pids_on_port(port: int) -> list[int]:
    lsof = shutil.which("lsof")
    if lsof is None:
        return []
    try:
        result = subprocess.run(
            [lsof, "-i", f"tcp:{port}", "-sTCP:LISTEN", "-t"],
            capture_output=True,
            text=True,
            shell=False,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    pids: list[int] = []
    for line in result.stdout.splitlines():
        try:
            pids.append(int(line.strip()))
        except ValueError:
            continue
    return pids


def teardown_ports(ports: tuple[int, ...] = (DEALER_PORT, UI_PORT, BRIDGE_PORT)) -> int:
    """Kill listeners on each port. Returns the count of processes terminated."""
    killed = 0
    self_pid = os.getpid()
    for port in ports:
        pids = (
            _windows_pids_on_port(port)
            if os.name == "nt"
            else _posix_pids_on_port(port)
        )
        if not pids:
            log("launcher", f"port {port} already free")
            continue
        for pid in pids:
            if pid == self_pid or pid == 0:
                continue
            log("launcher", f"killing pid={pid} on port {port}")
            try:
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(pid)],
                        capture_output=True,
                        shell=False,
                        check=False,
                        timeout=10,
                    )
                else:
                    os.kill(pid, signal.SIGTERM)
                    time.sleep(0.3)
                    try:
                        os.kill(pid, 0)
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                killed += 1
            except (OSError, subprocess.SubprocessError) as err:
                log("launcher", f"failed to kill pid={pid}: {err}")
    return killed


# ----------------------------------------------------------------------------
# Seeding — first-run bootstrap message to the dedicated OpenClaw session.
# ----------------------------------------------------------------------------


def seed_openclaw_session(force: bool = False) -> bool:
    """Send the bootstrap text once. Returns True if seeding succeeded or was skipped."""
    current_sha = bootstrap_sha256(BOOTSTRAP_TEXT)
    if not should_reseed(SENTINEL_PATH, current_sha, force=force):
        log("launcher", f"seed: skipped (sentinel sha matches: {current_sha[:12]}...)")
        return True

    if shutil.which("openclaw") is None:
        log(
            "launcher",
            "seed: openclaw CLI not on PATH — skipping (you can re-seed later with --force-seed)",
        )
        return False

    try:
        argv = _resolve_openclaw_argv(
            BOOTSTRAP_TEXT, ALLOWED_AGENT_ID, SESSION_LABEL, timeout_sec=60
        )
    except (ValueError, RuntimeError) as err:
        log("launcher", f"seed: refused: {err}")
        return False

    log(
        "launcher",
        f"seed: sending bootstrap (sha={current_sha[:12]}...) to session {SESSION_LABEL}",
    )
    try:
        result = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            shell=False,
            check=False,
            timeout=90,
        )
    except (OSError, subprocess.TimeoutExpired) as err:
        log("launcher", f"seed: spawn failed: {err}")
        return False

    if result.returncode != 0:
        # Never echo full stderr — it may contain credentials or reply text.
        log("launcher", f"seed: CLI exited {result.returncode}")
        return False

    ready = False
    try:
        envelope = json.loads(result.stdout)
        reply_text = _extract_reply_text(envelope)
        if reply_text:
            try:
                inner = json.loads(reply_text)
                ready = bool(inner.get("ready") is True)
            except (json.JSONDecodeError, AttributeError):
                ready = False
    except json.JSONDecodeError:
        log("launcher", "seed: CLI returned non-JSON envelope")

    SENTINEL_PATH.write_text(
        f"sha256={current_sha}\n"
        f"date={time.strftime('%Y-%m-%dT%H:%M:%S')}\n"
        f"agent={ALLOWED_AGENT_ID}\n"
        f"session={SESSION_LABEL}\n"
        f"ready={'true' if ready else 'false'}\n",
        encoding="utf-8",
    )
    if ready:
        log("launcher", "seed: agent acknowledged { ready: true }")
    else:
        log(
            "launcher",
            "seed: agent did not return { ready: true } — sentinel written anyway, retry with --force-seed if needed",
        )
    return True


def _extract_reply_text(envelope: object) -> str | None:
    """Pull the assistant text out of an OpenClaw `agent --json` envelope.

    Mirrors the bridge's extractReplyFromEnvelope shape recognition.
    """
    if not isinstance(envelope, dict):
        return None
    result = envelope.get("result")
    if isinstance(result, dict):
        payloads = result.get("payloads")
        if isinstance(payloads, list):
            for p in payloads:
                if isinstance(p, dict):
                    text = p.get("text")
                    if isinstance(text, str) and text.strip():
                        return text
    for key in ("reply", "message", "text", "output", "assistant"):
        v = envelope.get(key)
        if isinstance(v, str) and v.strip():
            return v
    return None


# ----------------------------------------------------------------------------
# Supervisor — Popen + log pump + cleanup.
# ----------------------------------------------------------------------------


class Child:
    __slots__ = ("name", "proc", "threads")

    def __init__(
        self, name: str, proc: subprocess.Popen, threads: list[threading.Thread]
    ):
        self.name = name
        self.proc = proc
        self.threads = threads


def spawn_child(
    name: str, argv: list[str], env: dict[str, str], stop_event: threading.Event
) -> Child:
    """Start a child with stdout/stderr pumped through the redacting logger."""
    log("launcher", f"spawning {name}: {' '.join(argv)}")
    creationflags = 0
    if os.name == "nt":
        # Put each child in its own process group so Ctrl+C in the launcher's
        # console does not propagate to children before we have a chance to
        # signal them deliberately (and so taskkill /T can find descendants).
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    proc = subprocess.Popen(
        argv,
        cwd=str(PROJECT_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        shell=False,  # CRITICAL: never True. argv-only.
        bufsize=0,
        creationflags=creationflags,
    )
    t_out = threading.Thread(
        target=_pump, args=(name, proc.stdout, stop_event), daemon=True
    )
    t_err = threading.Thread(
        target=_pump, args=(name, proc.stderr, stop_event), daemon=True
    )
    t_out.start()
    t_err.start()
    return Child(name=name, proc=proc, threads=[t_out, t_err])


def stop_children(children: list[Child], grace_sec: float = 5.0) -> None:
    """Terminate every child cleanly; escalate to kill on timeout."""
    for c in children:
        if c.proc.poll() is not None:
            continue
        log("launcher", f"stopping {c.name} (pid={c.proc.pid})")
        try:
            if os.name == "nt":
                # taskkill /T kills the whole tree (npm/concurrently spawn grandchildren).
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(c.proc.pid)],
                    capture_output=True,
                    shell=False,
                    check=False,
                    timeout=10,
                )
            else:
                c.proc.terminate()
        except (OSError, subprocess.SubprocessError):
            pass
    deadline = time.monotonic() + grace_sec
    for c in children:
        remaining = max(0.0, deadline - time.monotonic())
        try:
            c.proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            try:
                c.proc.kill()
            except OSError:
                pass


# ----------------------------------------------------------------------------
# Top-level orchestration.
# ----------------------------------------------------------------------------


def run_launcher(mode: str, force_seed: bool) -> int:
    """Boot all children for the given mode. Returns process exit code."""
    if mode not in ("live", "dry"):
        log("launcher", f"unknown mode: {mode}")
        return 2

    # Refuse to spawn the bridge if env is misconfigured to point at a banned agent.
    env_agent = os.environ.get("POKERCLAW_BRIDGE_LIVE_AGENT_ID", "").strip()
    if env_agent:
        try:
            validate_agent_id(env_agent)
        except ValueError as err:
            log("launcher", f"refusing to spawn bridge: {err}")
            return 3

    # Peek at the strategy before building the full env so we know whether to
    # require BRIDGE_PORT to be free. fast-live + live mode does not spawn the
    # bridge, so a stale bridge process on 5179 is not a hard blocker.
    early_strategy = (
        (
            os.environ.get("POKERCLAW_STRATEGY")
            or load_dotenv(PROJECT_ROOT / ".env").get("POKERCLAW_STRATEGY")
            or DEFAULT_FAST_LIVE_ENV["POKERCLAW_STRATEGY"]
        )
        .strip()
        .lower()
    )
    needs_bridge_port = early_strategy == "openclaw-bridge" or mode == "dry"
    busy = precheck_ports(include_bridge=needs_bridge_port)
    if busy:
        log(
            "launcher",
            f"ports already in use: {busy}. Run `python poker.py teardown` first.",
        )
        return 4

    stop_event = threading.Event()
    children: list[Child] = []
    exit_code = 0

    def handle_sigint(_signum, _frame):
        log("launcher", "Ctrl+C received — shutting down children...")
        stop_event.set()

    previous_sigint = signal.signal(signal.SIGINT, handle_sigint)
    try:
        child_env = build_child_env()
        strategy = child_env.get("POKERCLAW_STRATEGY", "fast-live").strip().lower()
        bridge_needed = strategy == "openclaw-bridge" or mode == "dry"

        # 1. Seed first — only meaningful when the bridge will actually run.
        #    fast-live mode never talks to OpenClaw, so seeding is pointless
        #    (and slow). `dry` mode also skips since the bridge runs in
        #    --dry-run and never calls the CLI.
        if mode == "live" and strategy == "openclaw-bridge":
            seed_openclaw_session(force=force_seed)
        elif mode == "dry":
            log("launcher", "dry mode: skipping OpenClaw seed")
        else:
            log(
                "launcher",
                f"strategy={strategy}: skipping OpenClaw seed (bridge not in use)",
            )

        # Defense in depth: even after merging DEFAULT_BRIDGE_ENV, re-validate
        # whenever the bridge is in the loop.
        if bridge_needed:
            try:
                validate_agent_id(child_env.get("POKERCLAW_BRIDGE_LIVE_AGENT_ID", ""))
            except ValueError as err:
                log("launcher", f"refusing to spawn bridge: {err}")
                return 3

        bridge_script = "bridge:dry-run" if mode == "dry" else "bridge"

        # 2. Spawn dealer+UI, optionally bridge, then agent.
        children.append(spawn_child("dealer", _npm_argv("dev"), child_env, stop_event))
        if bridge_needed:
            children.append(
                spawn_child("bridge", _npm_argv(bridge_script), child_env, stop_event)
            )
            # Agent talks to the bridge — give the bridge a beat to bind.
            time.sleep(0.5)
        else:
            log("launcher", "fast-live: skipping bridge subprocess")
        children.append(spawn_child("agent", _npm_argv("agent"), child_env, stop_event))

        # 3. Health-gate the browser open on dealer readiness.
        if wait_for_dealer(timeout_sec=30):
            log("launcher", f"dealer ready, opening {UI_URL}")
            try:
                webbrowser.open(UI_URL, new=2)
            except Exception as err:  # noqa: BLE001 — webbrowser raises a wide set
                log("launcher", f"could not open browser: {err}")
        else:
            log("launcher", "dealer did not become healthy within 30s — tearing down")
            return 5

        # 4. Supervise loop.
        while not stop_event.is_set():
            for c in children:
                rc = c.proc.poll()
                if rc is not None:
                    log("launcher", f"{c.name} exited with code {rc} — shutting down")
                    stop_event.set()
                    exit_code = rc if rc != 0 else 0
                    break
            time.sleep(0.5)
    finally:
        signal.signal(signal.SIGINT, previous_sigint)
        stop_children(children)
        log("launcher", "all children stopped")

    return exit_code


def parse_args(argv: list[str]) -> tuple[str, bool]:
    """Returns (mode, force_seed). Mode is one of: live, dry, teardown."""
    parser = argparse.ArgumentParser(
        prog="poker.py",
        description="PokerClaw one-command launcher (dealer + UI + bridge + agent).",
        add_help=True,
    )
    parser.add_argument(
        "mode",
        nargs="?",
        default="live",
        choices=("live", "dry", "teardown"),
        help="live = full boot (default); dry = bridge:dry-run, no OpenClaw seed; teardown = kill leftovers.",
    )
    parser.add_argument(
        "--force-seed",
        action="store_true",
        help="Re-send the bootstrap message even if the sentinel SHA matches.",
    )
    ns = parser.parse_args(argv)
    return ns.mode, ns.force_seed


def main(argv: list[str] | None = None) -> int:
    mode, force_seed = parse_args(list(argv) if argv is not None else sys.argv[1:])
    if mode == "teardown":
        killed = teardown_ports()
        log("launcher", f"teardown complete — killed {killed} process(es)")
        return 0
    return run_launcher(mode=mode, force_seed=force_seed)


if __name__ == "__main__":
    sys.exit(main())
