import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error — importing the bridge resolver .mjs for unit tests; no .d.ts ship.
import { resolveCli, __clearCliResolveCache } from '../bridge/resolve-cli.mjs';
// @ts-expect-error — importing the bridge .mjs for unit tests; no .d.ts ship.
import { unwrapNpmCmdShim } from '../bridge/moltfire-bridge.mjs';

// Builds a minimal fake fs whose statSync(p) only succeeds for paths in
// `existing`. Matches case-insensitively on Windows-style paths, exactly on
// Unix-style paths.
function makeFakeFs(existing: string[], { caseInsensitive }: { caseInsensitive: boolean }) {
  const set = new Set(
    existing.map((p) => (caseInsensitive ? p.toLowerCase() : p)),
  );
  return {
    statSync(p: string) {
      const key = caseInsensitive ? p.toLowerCase() : p;
      if (!set.has(key)) {
        const err: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      return {
        isFile: () => true,
        mode: 0o755,
      };
    },
  };
}

describe('resolveCli — passthrough cases', () => {
  beforeEach(() => __clearCliResolveCache());

  it('returns a Windows absolute path unchanged (and never touches fs)', () => {
    let fsHits = 0;
    const fakeFs = {
      statSync(_p: string) {
        fsHits += 1;
        throw new Error('should not be called');
      },
    };
    const out = resolveCli('C:\\tools\\openclaw\\openclaw.CMD', {
      env: { PATH: 'C:\\tools', PATHEXT: '.EXE;.CMD' },
      platform: 'win32',
      fs: fakeFs,
      cache: new Map(),
    });
    expect(out).toBe('C:\\tools\\openclaw\\openclaw.CMD');
    expect(fsHits).toBe(0);
  });

  it('returns a POSIX absolute path unchanged', () => {
    const out = resolveCli('/usr/local/bin/openclaw', {
      env: { PATH: '/usr/bin:/bin' },
      platform: 'linux',
      fs: { statSync: () => { throw new Error('not called'); } },
      cache: new Map(),
    });
    expect(out).toBe('/usr/local/bin/openclaw');
  });

  it('passes through inputs containing a forward-slash separator (./openclaw)', () => {
    const out = resolveCli('./openclaw', {
      env: { PATH: '/usr/bin' },
      platform: 'linux',
      fs: { statSync: () => { throw new Error('not called'); } },
      cache: new Map(),
    });
    expect(out).toBe('./openclaw');
  });

  it('passes through inputs containing a backslash separator (..\\openclaw.cmd)', () => {
    const out = resolveCli('..\\openclaw.CMD', {
      env: { PATH: 'C:\\tools', PATHEXT: '.CMD' },
      platform: 'win32',
      fs: { statSync: () => { throw new Error('not called'); } },
      cache: new Map(),
    });
    expect(out).toBe('..\\openclaw.CMD');
  });
});

describe('resolveCli — Windows PATH + PATHEXT lookup', () => {
  beforeEach(() => __clearCliResolveCache());

  it('finds openclaw.cmd via PATHEXT walk on a synthetic Windows PATH', () => {
    const existing = ['C:\\tools\\bin\\openclaw.CMD'];
    const fakeFs = makeFakeFs(existing, { caseInsensitive: true });
    const out = resolveCli('openclaw', {
      env: {
        PATH: 'C:\\Windows\\System32;C:\\tools\\bin',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      },
      platform: 'win32',
      fs: fakeFs,
      cache: new Map(),
    });
    expect(out).toBe('C:\\tools\\bin\\openclaw.CMD');
  });

  it('prefers .EXE over .CMD when both exist (PATHEXT ordering)', () => {
    const existing = [
      'C:\\tools\\bin\\openclaw.exe',
      'C:\\tools\\bin\\openclaw.CMD',
    ];
    const fakeFs = makeFakeFs(existing, { caseInsensitive: true });
    const out = resolveCli('openclaw', {
      env: {
        PATH: 'C:\\tools\\bin',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      },
      platform: 'win32',
      fs: fakeFs,
      cache: new Map(),
    });
    expect(out).toBe('C:\\tools\\bin\\openclaw.EXE');
  });

  it('uses the default PATHEXT when env.PATHEXT is missing', () => {
    const existing = ['C:\\tools\\bin\\openclaw.CMD'];
    const fakeFs = makeFakeFs(existing, { caseInsensitive: true });
    const out = resolveCli('openclaw', {
      env: { PATH: 'C:\\tools\\bin' },
      platform: 'win32',
      fs: fakeFs,
      cache: new Map(),
    });
    expect(out).toBe('C:\\tools\\bin\\openclaw.CMD');
  });

  it('walks PATH in order — returns first directory that has a hit', () => {
    const existing = [
      'C:\\tools\\later\\openclaw.CMD',
      'C:\\tools\\first\\openclaw.CMD',
    ];
    const fakeFs = makeFakeFs(existing, { caseInsensitive: true });
    const out = resolveCli('openclaw', {
      env: {
        PATH: 'C:\\tools\\first;C:\\tools\\later',
        PATHEXT: '.EXE;.CMD',
      },
      platform: 'win32',
      fs: fakeFs,
      cache: new Map(),
    });
    expect(out).toBe('C:\\tools\\first\\openclaw.CMD');
  });
});

describe('resolveCli — POSIX PATH lookup', () => {
  beforeEach(() => __clearCliResolveCache());

  it('finds an executable file on PATH (Linux/macOS)', () => {
    const existing = ['/usr/local/bin/openclaw'];
    const fakeFs = makeFakeFs(existing, { caseInsensitive: false });
    const out = resolveCli('openclaw', {
      env: { PATH: '/usr/bin:/bin:/usr/local/bin' },
      platform: 'linux',
      fs: fakeFs,
      cache: new Map(),
    });
    expect(out).toBe('/usr/local/bin/openclaw');
  });
});

describe('resolveCli — failure modes', () => {
  beforeEach(() => __clearCliResolveCache());

  it('throws cli-not-found when nothing on PATH matches (Windows)', () => {
    const fakeFs = makeFakeFs([], { caseInsensitive: true });
    expect(() =>
      resolveCli('openclaw', {
        env: {
          PATH: 'C:\\Windows\\System32;C:\\tools\\bin',
          PATHEXT: '.COM;.EXE;.BAT;.CMD',
        },
        platform: 'win32',
        fs: fakeFs,
        cache: new Map(),
      }),
    ).toThrow(/cli-not-found:openclaw/);
  });

  it('throws cli-not-found when nothing on PATH matches (POSIX)', () => {
    const fakeFs = makeFakeFs([], { caseInsensitive: false });
    expect(() =>
      resolveCli('openclaw', {
        env: { PATH: '/usr/bin:/bin' },
        platform: 'linux',
        fs: fakeFs,
        cache: new Map(),
      }),
    ).toThrow(/cli-not-found:openclaw/);
  });

  it('hint mentions POKERCLAW_BRIDGE_CLI_PATH so the operator knows what to set', () => {
    const fakeFs = makeFakeFs([], { caseInsensitive: false });
    expect(() =>
      resolveCli('openclaw', {
        env: { PATH: '/usr/bin' },
        platform: 'linux',
        fs: fakeFs,
        cache: new Map(),
      }),
    ).toThrow(/POKERCLAW_BRIDGE_CLI_PATH/);
  });

  it('rejects an empty input', () => {
    expect(() =>
      resolveCli('', {
        env: { PATH: '/usr/bin' },
        platform: 'linux',
        fs: makeFakeFs([], { caseInsensitive: false }),
        cache: new Map(),
      }),
    ).toThrow(/cli-not-found/);
  });
});

describe('resolveCli — caching', () => {
  beforeEach(() => __clearCliResolveCache());

  it('does not re-scan PATH on a second lookup of the same name', () => {
    let statCalls = 0;
    const existing = new Set(['c:\\tools\\bin\\openclaw.cmd']);
    const fakeFs = {
      statSync(p: string) {
        statCalls += 1;
        if (!existing.has(p.toLowerCase())) {
          const err: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
          err.code = 'ENOENT';
          throw err;
        }
        return { isFile: () => true, mode: 0o755 };
      },
    };
    const sharedCache = new Map();
    const env = {
      PATH: 'C:\\Windows\\System32;C:\\tools\\bin',
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
    };
    const first = resolveCli('openclaw', {
      env, platform: 'win32', fs: fakeFs, cache: sharedCache,
    });
    const firstCalls = statCalls;
    expect(firstCalls).toBeGreaterThan(0);
    const second = resolveCli('openclaw', {
      env, platform: 'win32', fs: fakeFs, cache: sharedCache,
    });
    expect(second).toBe(first);
    expect(statCalls).toBe(firstCalls);
  });

  it('caches absolute-path passthrough too (no fs hits on second call)', () => {
    let statCalls = 0;
    const fakeFs = {
      statSync(_p: string) {
        statCalls += 1;
        throw new Error('should never be called');
      },
    };
    const sharedCache = new Map();
    const env = { PATH: 'C:\\Windows', PATHEXT: '.EXE;.CMD' };
    const p = 'C:\\tools\\openclaw\\openclaw.exe';
    resolveCli(p, { env, platform: 'win32', fs: fakeFs, cache: sharedCache });
    resolveCli(p, { env, platform: 'win32', fs: fakeFs, cache: sharedCache });
    expect(statCalls).toBe(0);
  });
});

// -----------------------------------------------------------------------
// unwrapNpmCmdShim — Node v22 CVE-2024-27980 workaround. spawn() refuses
// .cmd/.bat files with shell:false, so when the resolver lands on an
// npm-style .cmd shim we look through it to the underlying node script
// and spawn node + script directly instead.
// -----------------------------------------------------------------------

describe('unwrapNpmCmdShim — peek inside npm .cmd shims', () => {
  it('returns a Windows npm shim .mjs path when the .cmd wraps node "...mjs"', () => {
    const cmdPath = 'C:\\Users\\me\\AppData\\Roaming\\npm\\openclaw.cmd';
    const mjsPath = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\openclaw\\openclaw.mjs';
    const body = [
      '@ECHO off',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ') ELSE (',
      '  SET "_prog=node"',
      '  SET PATHEXT=%PATHEXT:;.JS;=;%',
      ')',
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\openclaw\\openclaw.mjs" %*',
    ].join('\r\n');
    const fakeFs = {
      readFileSync(p: string) {
        if (p === cmdPath) return body;
        throw new Error(`ENOENT: ${p}`);
      },
      statSync(p: string) {
        if (p === mjsPath) return { isFile: () => true };
        const err: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      },
    };
    const out = unwrapNpmCmdShim(cmdPath, { fs: fakeFs });
    expect(out).toBe(mjsPath);
  });

  it('returns the .cmd unchanged when it does not match the npm shim pattern', () => {
    const cmdPath = 'C:\\tools\\foo.cmd';
    const body = '@echo hello\r\n';
    const fakeFs = {
      readFileSync(_p: string) { return body; },
      statSync(_p: string) {
        const err: NodeJS.ErrnoException = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    };
    const out = unwrapNpmCmdShim(cmdPath, { fs: fakeFs });
    expect(out).toBe(cmdPath);
  });

  it('returns non-.cmd/.bat inputs unchanged without touching fs', () => {
    let hits = 0;
    const fakeFs = {
      readFileSync() { hits += 1; throw new Error('not called'); },
      statSync() { hits += 1; throw new Error('not called'); },
    };
    const out = unwrapNpmCmdShim('C:\\tools\\openclaw.exe', { fs: fakeFs });
    expect(out).toBe('C:\\tools\\openclaw.exe');
    expect(hits).toBe(0);
  });

  it('returns the .cmd path when the resolved .mjs target does not exist', () => {
    const cmdPath = 'C:\\tools\\openclaw.cmd';
    const body = '"%_prog%" "%dp0%\\node_modules\\openclaw\\openclaw.mjs" %*\r\n';
    const fakeFs = {
      readFileSync(_p: string) { return body; },
      statSync(_p: string) {
        const err: NodeJS.ErrnoException = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    };
    const out = unwrapNpmCmdShim(cmdPath, { fs: fakeFs });
    expect(out).toBe(cmdPath);
  });
});

