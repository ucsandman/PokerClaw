#!/usr/bin/env node
// MoltFire OpenClaw Bridge sidecar.
//
// A tiny localhost-only HTTP service the PokerClaw live agent talks to.
// Two modes:
//   - dry-run mode: returns a deterministic legal action without contacting
//     OpenClaw. Used to test the wiring end-to-end (npm run bridge:dry-run).
//   - live mode:    forwards the public hand context to a dedicated MoltFire
//                   OpenClaw agent + session and returns the parsed JSON
//                   action. The dedicated agent is `moltfire-poker`, NOT
//                   Wes's `main` MoltFire agent. See LIVE_BRIDGE_WIRING.md.
//
// Hard safety rules (per MOLTFIRE_OPENCLAW_BRIDGE.md + LIVE_BRIDGE_WIRING.md):
//   - Binds to 127.0.0.1 ONLY. Never 0.0.0.0, never a routable interface.
//   - No real or full LLM chain-of-thought is logged.
//   - No hole cards are ever logged.
//   - No reply text body is ever logged (only structured action summaries).
//   - On any error returns HTTP 502 so the agent falls back to its LLM / rules.
//   - Never spawns the live CLI against `--agent main` (or any documented
//     main-agent alias). Refuses to spawn against an empty agentId.
//   - Refuses empty session labels.
//   - Caps the outbound CLI message at 8 KB.
//   - Spawns the CLI without `shell: true`; all arguments pass as argv elements.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn as defaultSpawn } from 'node:child_process';
import { resolveCli as defaultResolveCli } from './resolve-cli.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('[bridge] unhandled rejection:', reason);
  process.exit(1);
});

const args = process.argv.slice(2);
const dryRun =
  args.includes('--dry-run') ||
  (process.env.POKERCLAW_BRIDGE_DRY_RUN ?? '').toLowerCase() === 'true';

const HOST = '127.0.0.1';
const PORT = clampInt(process.env.POKERCLAW_BRIDGE_PORT, 1024, 65535, 5179);
const SESSION_LABEL =
  (process.env.POKERCLAW_AGENT_BRIDGE_SESSION_LABEL ?? '').trim() || 'moltfire-pokerclaw';

// 8 KB ceiling on the CLI message — well above the serialized public hand
// context plus the prompt wrapper. Anything over is a sign of malformed input.
export const MAX_MESSAGE_BYTES = 8 * 1024;

// Hard-refuse list. The bridge must never target Wes's main MoltFire agent.
// Compared case-insensitively after trimming.
export const BANNED_AGENT_IDS = Object.freeze([
  'main',
  'default',
  'primary',
  'moltfire',
  'moltfire-main',
]);

// Allowed CLI binaries. Either the bare name `openclaw`, the bare name `npx`
// (for `npx openclaw`), or an absolute path the operator has configured.
// Absolute paths ending in `.mjs` or `.js` are spawned via `process.execPath`
// (node) — this is the only way to invoke the OpenClaw CLI on Windows + Node v22
// without `shell:true` (Node refuses to spawn .cmd/.bat with shell:false).
function isTrustedCliPath(p) {
  if (typeof p !== 'string') return false;
  const trimmed = p.trim();
  if (!trimmed) return false;
  if (trimmed === 'openclaw') return true;
  if (trimmed === 'npx') return true;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true; // Windows absolute
  if (trimmed.startsWith('/')) return true; // POSIX absolute
  return false;
}

function isNodeScriptPath(p) {
  return typeof p === 'string' && /\.(mjs|cjs|js)$/i.test(p.trim());
}

// Node v22 (CVE-2024-27980) refuses to spawn `.cmd` / `.bat` files when
// `shell: false`. The PATHEXT resolver dutifully finds `openclaw.cmd`, but
// passing it to `spawn` throws `EINVAL`. npm-style `.cmd` shims are wrappers
// of the form `node "%dp0%\node_modules\<pkg>\<entry>.mjs" %*`; when we detect
// that shape we substitute the underlying `.mjs` (or `.js` / `.cjs`) and let
// the existing `isNodeScriptPath` branch spawn `node <script>` directly. No
// shell, no extra dependency — the .cmd is read once during dispatch only.
//
// Mirrors poker.py's `_resolve_openclaw_argv` Windows path.
export function unwrapNpmCmdShim(cmdPath, opts = {}) {
  const fsImpl = opts.fs ?? fs;
  const pathMod = opts.path ?? path;
  if (typeof cmdPath !== 'string') return cmdPath;
  if (!/\.(cmd|bat)$/i.test(cmdPath)) return cmdPath;
  let body;
  try {
    body = fsImpl.readFileSync(cmdPath, 'utf8');
  } catch {
    return cmdPath;
  }
  const match = body.match(/"([^"\r\n]+\.(?:mjs|cjs|js))"/i);
  if (!match) return cmdPath;
  const dir = pathMod.dirname(cmdPath);
  let scriptPath = match[1].replace(/%~dp0\\?/gi, dir + pathMod.sep);
  scriptPath = scriptPath.replace(/%dp0%\\?/gi, dir + pathMod.sep);
  if (!pathMod.isAbsolute(scriptPath)) {
    scriptPath = pathMod.resolve(dir, scriptPath);
  }
  try {
    if (fsImpl.statSync(scriptPath).isFile()) return scriptPath;
  } catch {}
  return cmdPath;
}

// -----------------------------------------------------------------------
// HTTP server
// -----------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  // 127.0.0.1 binding already enforces locality, but defend in depth: refuse
  // any request whose Host header doesn't look local.
  const host = (req.headers.host ?? '').split(':')[0].toLowerCase();
  if (host && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    return sendJson(res, 403, { error: 'localhost-only' });
  }

  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, {
      ok: true,
      mode: dryRun ? 'dry-run' : 'live',
      sessionLabel: SESSION_LABEL,
    });
  }

  if (req.method === 'POST' && req.url === '/decide') {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendJson(res, 400, { error: shortErr(err) });
    }
    try {
      const ctx = extractPublicContext(body);
      if (!ctx) return sendJson(res, 400, { error: 'malformed-publicHandContext' });

      const result = dryRun
        ? deterministicDecide(ctx)
        : await dispatchToOpenClaw(ctx, SESSION_LABEL);

      if (!result || !result.action) {
        return sendJson(res, 502, { error: 'no-action' });
      }
      // Log only the public-safe summary — never the rationale text body, the
      // reply text, or hole cards. Action type + bet amount + street + pot +
      // source + agent id + session label is the full log surface.
      console.log(formatActionLog({
        action: result.action,
        street: ctx.street,
        pot: ctx.pot,
        source: dryRun ? 'dry-run' : 'live',
        agentId: dryRun ? '-' : (result.agentId ?? '-'),
        sessionLabel: SESSION_LABEL,
      }));
      return sendJson(res, 200, {
        action: result.action,
        rationale: typeof result.rationale === 'string' ? result.rationale : 'openclaw-bridge',
      });
    } catch (err) {
      console.error('[bridge] /decide error:', shortErr(err));
      return sendJson(res, 502, { error: 'bridge-failure' });
    }
  }

  sendJson(res, 404, { error: 'not-found' });
});

// Only listen when run as a script, not when imported by tests.
// Compare normalized URL forms — Windows file URLs use forward slashes and the
// script path uses backslashes, so we have to canonicalize both sides.
function isInvokedAsScript() {
  const entry = process.argv[1];
  if (!entry) return false;
  const entryUrl = 'file:///' + entry.replace(/\\/g, '/').replace(/^\/+/, '');
  const here = import.meta.url.replace(/^file:\/\/\/?/, 'file:///');
  return here === entryUrl;
}
if (isInvokedAsScript()) {
  server.listen(PORT, HOST, () => {
    console.log(
      `[bridge] listening http://${HOST}:${PORT} mode=${dryRun ? 'dry-run' : 'live'} sessionLabel=${SESSION_LABEL}`,
    );
    if (!dryRun) {
      const liveCfg = safeResolveLiveConfig(process.env);
      if (liveCfg.ok) {
        console.log(
          `[bridge] live mode: agentId=${liveCfg.value.agentId} cli=${liveCfg.value.cliPath} timeoutSec=${liveCfg.value.timeoutSec}`,
        );
      } else {
        console.error(
          `[bridge] live mode misconfigured: ${liveCfg.error}. Falling /decide calls back to 502 until fixed.`,
        );
      }
    }
  });

  process.on('SIGINT', () => {
    console.log('[bridge] shutting down');
    server.close(() => process.exit(0));
  });
}

// -----------------------------------------------------------------------
// Dry-run decision (no external call).
// -----------------------------------------------------------------------

// Deterministic policy that always returns a legal action. Mirrors the
// PokerClaw safe fallback ladder: check → cheap call → bet small → fold.
// Used purely to validate the bridge wiring with no LLM/OpenClaw cost.
export function deterministicDecide(ctx) {
  const legal = ctx.legalActions ?? {};
  if (legal.check) {
    return { action: { type: 'check' }, rationale: 'dry-run: check' };
  }
  const toCall = Number(legal.callTo ?? 0) - Number(ctx.myCommittedThisStreet ?? 0);
  if (legal.call && Number.isFinite(toCall) && toCall <= Number(ctx.bigBlind ?? 0)) {
    return { action: { type: 'call' }, rationale: 'dry-run: cheap call' };
  }
  if (legal.canBet) {
    const amount = clampInt(legal.minBetTo, legal.minBetTo, legal.maxBetTo, legal.minBetTo);
    return { action: { type: 'bet', amount }, rationale: 'dry-run: min bet' };
  }
  if (legal.fold) {
    return { action: { type: 'fold' }, rationale: 'dry-run: fold' };
  }
  if (legal.call) {
    return { action: { type: 'call' }, rationale: 'dry-run: forced call' };
  }
  return null;
}

// -----------------------------------------------------------------------
// Live OpenClaw dispatch.
// -----------------------------------------------------------------------

// Live config resolution. Returns the normalized live-bridge config object
// or throws on misconfiguration. Throwing inside dispatchToOpenClaw causes
// the /decide handler to return 502, which is the correct behavior: the
// PokerClaw agent then falls back to its LLM and finally to its rule chain.
export function resolveLiveConfig(env = process.env) {
  const agentId = (env.POKERCLAW_BRIDGE_LIVE_AGENT_ID ?? '').trim() || 'moltfire-poker';
  if (!agentId) throw new Error('live-agent-id-empty');
  const lowered = agentId.toLowerCase();
  for (const banned of BANNED_AGENT_IDS) {
    if (lowered === banned) throw new Error(`live-agent-id-banned:${agentId}`);
  }
  const cliPath = (env.POKERCLAW_BRIDGE_CLI_PATH ?? '').trim() || 'openclaw';
  if (!isTrustedCliPath(cliPath)) throw new Error(`live-cli-untrusted:${cliPath}`);
  const timeoutSec = clampInt(env.POKERCLAW_BRIDGE_LIVE_TIMEOUT_SEC, 1, 300, 30);
  const model = (env.POKERCLAW_BRIDGE_LIVE_MODEL ?? '').trim();
  return { agentId, cliPath, timeoutSec, model };
}

function safeResolveLiveConfig(env) {
  try {
    return { ok: true, value: resolveLiveConfig(env) };
  } catch (err) {
    return { ok: false, error: shortErr(err) };
  }
}

// Test hook: lets tests swap out child_process.spawn so the CLI is never
// actually invoked. Production code paths always use the imported default.
let _spawnImpl = defaultSpawn;
export function __setSpawnForTests(fn) { _spawnImpl = fn ?? defaultSpawn; }
export function __resetSpawnForTests() { _spawnImpl = defaultSpawn; }

// Test hook: lets tests swap out the CLI resolver. By default this is the
// real PATHEXT-aware lookup; tests that just want to assert on the spawn argv
// install an identity function so a bare 'openclaw' name passes through
// unchanged regardless of what's on PATH in the test environment.
let _resolveCliImpl = defaultResolveCli;
export function __setResolveCliForTests(fn) { _resolveCliImpl = fn ?? defaultResolveCli; }
export function __resetResolveCliForTests() { _resolveCliImpl = defaultResolveCli; }

// Main live dispatch path.
//
// Steps:
//   1. Resolve and validate live config (rejects banned/empty agentIds,
//      untrusted CLI paths).
//   2. Build the strict prompt; refuse if it exceeds 8 KB.
//   3. Refuse if the session label is empty.
//   4. Spawn the CLI WITHOUT shell:true, passing all arguments as argv elements.
//   5. Buffer stdout; enforce a hard timeout that kills the child on expiry.
//   6. Parse the CLI envelope JSON, extract the assistant reply.
//   7. Run extractActionFromReply on the reply text — rejects chain-of-thought
//      and anything other than a single `{ action, rationale }` JSON object.
//   8. Validate the action against ctx.legalActions.
//   9. Return { action, rationale, agentId } — agentId for structured logging.
//
// On ANY failure (non-zero exit, timeout, malformed JSON, illegal action), throw.
// The HTTP handler returns 502 and the PokerClaw agent falls back cleanly.
export async function dispatchToOpenClaw(ctx, sessionLabel, opts = {}) {
  const env = opts.env ?? process.env;
  const spawnFn = opts.spawnFn ?? _spawnImpl;
  const resolveCliFn = opts.resolveCli ?? _resolveCliImpl;
  const label = typeof sessionLabel === 'string' ? sessionLabel.trim() : '';
  if (!label) throw new Error('session-label-empty');

  const cfg = resolveLiveConfig(env);
  const prompt = constructPrompt(ctx);
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  if (promptBytes > MAX_MESSAGE_BYTES) {
    throw new Error(`message-too-large:${promptBytes}`);
  }

  const argv = [
    'agent',
    '--agent', cfg.agentId,
    '--session-id', label,
    '--message', prompt,
    '--json',
    '--timeout', String(cfg.timeoutSec),
  ];
  if (cfg.cliPath === 'npx') argv.unshift('openclaw');
  if (cfg.model) {
    argv.push('--model', cfg.model);
  }

  // Windows + Node v22: spawn refuses to invoke .cmd/.bat with shell:false.
  // For a .mjs/.js/.cjs absolute path, spawn node directly with the script as
  // the first argv element. Still no shell, still argv-only.
  let cmd = cfg.cliPath;
  let finalArgv = argv;
  if (isNodeScriptPath(cfg.cliPath)) {
    cmd = process.execPath;
    finalArgv = [cfg.cliPath, ...argv];
  } else {
    // PATHEXT-aware lookup: bare 'openclaw'/'npx' become absolute paths so
    // child_process.spawn can find the .cmd/.bat/.exe shim on Windows without
    // shell:true. Absolute paths and any input with a path separator pass
    // through unchanged. Throws `cli-not-found:<name>` on failure, which the
    // /decide handler catches and turns into HTTP 502.
    cmd = resolveCliFn(cfg.cliPath, { env });
    // Node v22 refuses to spawn .cmd/.bat with shell:false (CVE-2024-27980).
    // npm shims are `node "...mjs" %*` wrappers — if we can see through the
    // .cmd to the underlying script, prefer spawning node with it directly.
    const unwrapped = unwrapNpmCmdShim(cmd);
    if (unwrapped !== cmd && isNodeScriptPath(unwrapped)) {
      cmd = process.execPath;
      finalArgv = [unwrapped, ...argv];
    }
  }

  let stdoutText;
  try {
    stdoutText = await runCli(spawnFn, cmd, finalArgv, cfg.timeoutSec * 1000);
  } catch (err) {
    // Emit redacted diagnostic — never echoes `--message` body or secrets.
    try {
      console.error(formatCliFailureDiag({
        cmd,
        argv: finalArgv,
        cwd: process.cwd(),
        diag: err && err.diag,
      }));
    } catch {}
    throw err;
  }

  let envelope;
  try {
    envelope = JSON.parse(stdoutText);
  } catch {
    throw new Error('cli-envelope-malformed');
  }

  const reply = extractReplyFromEnvelope(envelope);
  if (!reply) throw new Error('cli-reply-missing');

  const parsed = extractActionFromReply(reply);
  if (!parsed) throw new Error('cli-reply-not-strict-json');

  if (!isActionLegal(parsed.action, ctx.legalActions)) {
    throw new Error(`cli-action-illegal:${parsed.action?.type ?? 'unknown'}`);
  }

  return { action: parsed.action, rationale: parsed.rationale, agentId: cfg.agentId };
}

function runCli(spawnFn, cliPath, argv, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      // Pass shell:false explicitly — argv elements only. This is intentional:
      // the prompt contains JSON, not shell text, and we must not let any
      // future ctx contents accidentally hit a shell parser.
      child = spawnFn(cliPath, argv, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      const e = new Error(`cli-spawn-failed:${shortErr(err)}`);
      e.diag = { stage: 'spawn', cause: shortErr(err) };
      return reject(e);
    }
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    child.stdout?.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 256 * 1024) {
        if (!settled) {
          settled = true;
          try { child.kill(); } catch {}
          const e = new Error('cli-stdout-too-large');
          e.diag = { stage: 'stdout-cap', stdoutBytes };
          reject(e);
        }
        return;
      }
      stdout.push(chunk);
    });
    child.stderr?.on('data', (chunk) => { stderr.push(chunk); });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      const e = new Error('cli-timeout');
      e.diag = {
        stage: 'timeout',
        timedOut: true,
        timeoutMs: timeoutMs + 1000,
        stderrText: Buffer.concat(stderr).toString('utf8'),
      };
      reject(e);
    }, timeoutMs + 1000);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const e = new Error(`cli-error:${shortErr(err)}`);
      e.diag = { stage: 'process-error', cause: shortErr(err) };
      reject(e);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const e = new Error(`cli-exit-${code}`);
        e.diag = {
          stage: 'non-zero-exit',
          exitCode: code,
          stderrText: Buffer.concat(stderr).toString('utf8'),
          stdoutHead: Buffer.concat(stdout).toString('utf8').slice(0, 512),
        };
        return reject(e);
      }
      resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

// Redacts well-known secret-shaped tokens from a string so we can safely log
// stderr text or argv summaries. Patterns:
//   - Anthropic / OpenAI keys (sk-*, sk-ant-*)
//   - OpenClaw tokens (oc_*)
//   - Bearer headers (Authorization: Bearer ...)
//   - x-api-key headers
//   - POKERCLAW_AGENT_API_KEY values printed inline
export function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return '';
  let out = text;
  out = out.replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-***');
  out = out.replace(/oc_[A-Za-z0-9_\-]{8,}/g, 'oc_***');
  // Bearer tokens — with or without an Authorization header prefix.
  out = out.replace(/\bBearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***');
  out = out.replace(/(x-api-key\s*[:=]\s*)[A-Za-z0-9._\-]+/gi, '$1***');
  out = out.replace(/(POKERCLAW_AGENT_API_KEY\s*=\s*)\S+/gi, '$1***');
  return out;
}

// Builds a redacted, single-line diagnostic blob for safe console logging.
// The `--message` argv value is replaced with a length marker so the full
// prompt (which contains the JSON-serialized publicHandContext) never lands
// in stdout/stderr. Other argv elements are preserved verbatim.
export function summarizeArgvForDiag(argv) {
  if (!Array.isArray(argv)) return '[]';
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--message' && typeof argv[i + 1] === 'string') {
      out.push('--message', `<redacted:${argv[i + 1].length}b>`);
      i += 1;
      continue;
    }
    out.push(typeof a === 'string' ? redactSecrets(a) : String(a));
  }
  return JSON.stringify(out);
}

// Formats a diagnostic line for a CLI failure. Never includes hole cards
// (the argv `--message` value is redacted) or secret-shaped tokens.
export function formatCliFailureDiag({ cmd, argv, cwd, diag }) {
  const head = [
    `[bridge] cli-failure`,
    `cmd=${cmd}`,
    `cwd=${cwd}`,
    `argv=${summarizeArgvForDiag(argv)}`,
    `stage=${diag?.stage ?? 'unknown'}`,
  ];
  if (typeof diag?.exitCode === 'number') head.push(`exitCode=${diag.exitCode}`);
  if (diag?.timedOut) head.push(`timedOut=true`);
  if (typeof diag?.timeoutMs === 'number') head.push(`timeoutMs=${diag.timeoutMs}`);
  if (typeof diag?.stderrText === 'string' && diag.stderrText.trim()) {
    const lines = diag.stderrText.split(/\r?\n/).filter((l) => l.trim());
    const headLines = lines.slice(0, 3).join(' | ');
    const tailLines = lines.length > 6 ? ' ... ' + lines.slice(-3).join(' | ') : '';
    head.push(`stderr="${redactSecrets((headLines + tailLines).slice(0, 600))}"`);
  }
  if (typeof diag?.stdoutHead === 'string' && diag.stdoutHead.trim()) {
    head.push(`stdoutHead="${redactSecrets(diag.stdoutHead.slice(0, 200))}"`);
  }
  if (diag?.cause) head.push(`cause=${redactSecrets(String(diag.cause))}`);
  return head.join(' ');
}

// Pulls the assistant reply text out of the CLI's JSON envelope. Supports the
// OpenClaw CLI shape ({ result: { payloads: [{ text }] } }) plus common
// chat-style variants so the bridge survives minor CLI envelope drift.
//
// Recognized forms (first match wins):
//   { result: { payloads: [{ text: "..." }] } }   // OpenClaw `agent --json`
//   { reply: "..." }
//   { message: "..." }
//   { text: "..." }
//   { output: "..." }
//   { assistant: "..." }
//   { content: [{ text: "..." }, ...] }            // Anthropic-style content
//   { messages: [..., { role: "assistant", content: "..." }] }
//   { response: <any-of-the-above> }
export function extractReplyFromEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') return null;
  if (envelope.result && typeof envelope.result === 'object') {
    const payloads = envelope.result.payloads;
    if (Array.isArray(payloads)) {
      for (const p of payloads) {
        if (p && typeof p === 'object' && typeof p.text === 'string' && p.text.trim()) {
          return p.text;
        }
      }
    }
  }
  for (const key of ['reply', 'message', 'text', 'output', 'assistant']) {
    const v = envelope[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  if (Array.isArray(envelope.content)) {
    for (const block of envelope.content) {
      if (block && typeof block === 'object' && typeof block.text === 'string' && block.text.trim()) {
        return block.text;
      }
    }
  }
  if (Array.isArray(envelope.messages)) {
    for (let i = envelope.messages.length - 1; i >= 0; i--) {
      const m = envelope.messages[i];
      if (!m || typeof m !== 'object') continue;
      if (m.role && m.role !== 'assistant') continue;
      if (typeof m.content === 'string' && m.content.trim()) return m.content;
      if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block && typeof block === 'object' && typeof block.text === 'string' && block.text.trim()) {
            return block.text;
          }
        }
      }
    }
  }
  if (envelope.response && typeof envelope.response === 'object') {
    return extractReplyFromEnvelope(envelope.response);
  }
  return null;
}

// Strict reply parser. Accepts ONLY a single JSON object (optionally wrapped in
// whitespace) containing an `action` field. Rejects any chain-of-thought before
// or after the object. Returns { action, rationale } or null.
//
// We intentionally do NOT search for a `{...}` block inside arbitrary prose —
// that would let chain-of-thought through. Strict mode is the safer default;
// the dedicated MoltFire OpenClaw session is configured to emit JSON only.
export function extractActionFromReply(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;

  // Trimmed reply must be exactly one JSON object — no extra text on either side.
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  // Accept both shapes:
  //   nested: { action: { type, amount? }, rationale }
  //   flat:   { action: "type", amount?, rationale }
  let actionType;
  let rawAmount;
  if (parsed.action && typeof parsed.action === 'object' && !Array.isArray(parsed.action)) {
    actionType = parsed.action.type;
    rawAmount = parsed.action.amount;
  } else if (typeof parsed.action === 'string') {
    actionType = parsed.action;
    rawAmount = parsed.amount;
  } else {
    return null;
  }
  if (typeof actionType !== 'string') return null;
  if (!['fold', 'check', 'call', 'bet', 'raise'].includes(actionType)) return null;
  if (actionType === 'bet' || actionType === 'raise') {
    const n = Number(rawAmount);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  }

  const rationale = typeof parsed.rationale === 'string' ? parsed.rationale : '';
  // Normalize to a strict shape: drop any extra fields the agent might add.
  const cleanAction =
    actionType === 'bet' || actionType === 'raise'
      ? { type: actionType, amount: Math.trunc(Number(rawAmount)) }
      : { type: actionType };
  return { action: cleanAction, rationale };
}

// Validates a strict action against the legalActions block from the request.
// This is a final defense — the agent-side coerceAction is the primary gate
// for clamping, but we reject illegal types/amounts here too so the bridge
// can fail loud (502) instead of forwarding garbage.
function isActionLegal(action, legal) {
  if (!action || typeof action !== 'object' || !legal || typeof legal !== 'object') return false;
  switch (action.type) {
    case 'fold': return !!legal.fold;
    case 'check': return !!legal.check;
    case 'call': return !!legal.call;
    case 'bet': {
      if (!legal.canBet) return false;
      const a = Number(action.amount);
      if (!Number.isFinite(a)) return false;
      return a >= Number(legal.minBetTo) && a <= Number(legal.maxBetTo);
    }
    case 'raise': {
      if (!legal.canRaise) return false;
      const a = Number(action.amount);
      if (!Number.isFinite(a)) return false;
      return a >= Number(legal.minRaiseTo) && a <= Number(legal.maxRaiseTo);
    }
    default:
      return false;
  }
}

// Builds the strict message we send to the dedicated OpenClaw MoltFire session.
// Exported for tests and for live dispatch.
export function constructPrompt(ctx) {
  const json = JSON.stringify(ctx);
  return [
    'PokerClaw decision request.',
    '',
    "This is a live heads-up NLHE hand. You are MoltFire, the poker opponent. Match Mode is active. Fair Play Protocol applies. Do not reveal live hole cards anywhere except inside this JSON. Do not include chain-of-thought. Output JSON only — no markdown, no code fences, no explanation outside the JSON object.",
    '',
    'Public hand context:',
    json,
    '',
    'Your task: choose exactly one legal action. The "amount" you return for bet/raise is the TOTAL committed amount for this street after the action, not the chip delta. Output strict JSON in this exact shape (one of the two equivalent forms — nested is preferred):',
    '',
    '  Nested form (preferred):',
    '    { "action": { "type": "fold" | "check" | "call" | "bet" with "amount" | "raise" with "amount" }, "rationale": "<one-line public-safe rationale>" }',
    '',
    '  Flat form (also accepted):',
    '    { "action": "fold" | "check" | "call" | "bet" | "raise", "amount": <integer or 0>, "rationale": "<one-line public-safe rationale>" }',
    '',
    'All keys and string values must be double-quoted. No trailing commas. No markdown. No text outside the JSON object.',
  ].join('\n');
}

// -----------------------------------------------------------------------
// Logging
// -----------------------------------------------------------------------

function formatActionLog({ action, street, pot, source, agentId, sessionLabel }) {
  return `[bridge] decide street=${street} pot=${pot} -> ${describeAction(action)} (${source}) agent=${agentId} session=${sessionLabel}`;
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function extractPublicContext(body) {
  if (!body || typeof body !== 'object') return null;
  const c = body.publicHandContext;
  if (!c || typeof c !== 'object') return null;
  if (!c.legalActions || typeof c.legalActions !== 'object') return null;
  return c;
}

function describeAction(a) {
  if (!a || typeof a !== 'object') return 'unknown';
  switch (a.type) {
    case 'fold':
    case 'check':
    case 'call':
      return a.type;
    case 'bet':
    case 'raise':
      return `${a.type}:${a.amount}`;
    default:
      return 'unknown';
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      // Guard against runaway payloads: an honest decide payload is well under 64 KB.
      if (total > 256 * 1024) {
        reject(new Error('payload-too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function shortErr(err) {
  if (err instanceof Error) return err.message;
  return 'unknown-error';
}

function clampInt(raw, lo, hi, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

// Exported for tests.
export { server as __server };
