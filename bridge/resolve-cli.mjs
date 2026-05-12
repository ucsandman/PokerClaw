// PATHEXT-aware CLI resolver for the bridge sidecar.
//
// Node's child_process.spawn does not honor Windows PATHEXT, so on Windows
// `spawn('openclaw', ...)` cannot find `openclaw.cmd` / `openclaw.bat` /
// `openclaw.exe` shims unless `shell: true` is used. We intentionally never
// use `shell: true` (argv must stay argv), so we resolve the absolute path
// here using Node stdlib only.
//
// Rules:
//   1. If the input contains a path separator (`/`, `\`) or starts with a
//      Windows drive letter, return it unchanged. The caller is responsible
//      for passing a real path.
//   2. Otherwise walk `process.env.PATH`:
//        - On Windows, for each PATH entry, try the bare name plus every
//          `process.env.PATHEXT` extension. Return the first existing file.
//        - On other platforms, for each PATH entry, return the first existing
//          file with an executable mode bit; fall back to first existing file.
//   3. Cache the resolved path for the lifetime of the process so we don't
//      hit the disk on every `/decide`.
//   4. On lookup failure, throw `cli-not-found:<name> (...)`. The bridge's
//      /decide handler turns any throw here into HTTP 502 so the PokerClaw
//      agent falls back to its LLM chain.

import fs from 'node:fs';
import path from 'node:path';

const moduleCache = new Map();

// Test hook: clears the module-level cache between cases.
export function __clearCliResolveCache(cache = moduleCache) {
  cache.clear();
}

function containsPathSeparatorOrDrive(value) {
  if (value.includes('/') || value.includes('\\')) return true;
  return /^[A-Za-z]:/.test(value);
}

function statSafe(fsImpl, p) {
  try {
    return fsImpl.statSync(p);
  } catch {
    return null;
  }
}

function isFile(fsImpl, p) {
  const st = statSafe(fsImpl, p);
  return !!(st && st.isFile());
}

function isExecutableUnix(fsImpl, p) {
  const st = statSafe(fsImpl, p);
  if (!st || !st.isFile()) return false;
  if (typeof st.mode === 'number') {
    return (st.mode & 0o111) !== 0;
  }
  return true;
}

export function resolveCli(input, opts = {}) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const fsImpl = opts.fs ?? fs;
  const cache = opts.cache ?? moduleCache;

  if (typeof input !== 'string') {
    throw new Error('cli-not-found:input-not-string');
  }
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('cli-not-found:empty-name');
  }

  if (cache.has(trimmed)) return cache.get(trimmed);

  if (containsPathSeparatorOrDrive(trimmed)) {
    cache.set(trimmed, trimmed);
    return trimmed;
  }

  const pathSep = platform === 'win32' ? ';' : ':';
  const pathMod = platform === 'win32' ? path.win32 : path.posix;
  const rawPath = env.PATH ?? env.Path ?? env.path ?? '';
  const dirs = rawPath.split(pathSep).map((d) => d.trim()).filter(Boolean);

  if (platform === 'win32') {
    const rawExt = env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD';
    const exts = rawExt.split(';').map((e) => e.trim()).filter(Boolean);
    const lower = trimmed.toLowerCase();
    const alreadyHasExt = exts.some((ext) => lower.endsWith(ext.toLowerCase()));
    for (const dir of dirs) {
      if (alreadyHasExt) {
        const candidate = pathMod.join(dir, trimmed);
        if (isFile(fsImpl, candidate)) {
          cache.set(trimmed, candidate);
          return candidate;
        }
      }
      for (const ext of exts) {
        const candidate = pathMod.join(dir, trimmed + ext);
        if (isFile(fsImpl, candidate)) {
          cache.set(trimmed, candidate);
          return candidate;
        }
      }
    }
  } else {
    for (const dir of dirs) {
      const candidate = pathMod.join(dir, trimmed);
      if (isExecutableUnix(fsImpl, candidate)) {
        cache.set(trimmed, candidate);
        return candidate;
      }
    }
    for (const dir of dirs) {
      const candidate = pathMod.join(dir, trimmed);
      if (isFile(fsImpl, candidate)) {
        cache.set(trimmed, candidate);
        return candidate;
      }
    }
  }

  throw new Error(
    `cli-not-found:${trimmed} (set POKERCLAW_BRIDGE_CLI_PATH to an absolute path)`,
  );
}
