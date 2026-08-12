/**
 * Valkey config-factory tests (KAN-160).
 *
 * Focus: VALKEY_PORT validation. Copilot review on PR #3392 flagged that a
 * bare Number.parseInt let a non-numeric VALKEY_PORT become NaN, which made
 * ioredis fail to connect and Express silently fall back to MemoryStore —
 * the exact silent-degradation class this PR exists to kill.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VALKEY_PORT,
  RATE_LIMIT_PREFIXES,
  resolveValkeyConfig,
  resolveValkeyPort,
} from './valkey-config.js';

describe('resolveValkeyPort', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns the default when VALKEY_PORT is unset', () => {
    expect(resolveValkeyPort(undefined)).toBe(DEFAULT_VALKEY_PORT);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns the default when VALKEY_PORT is empty', () => {
    expect(resolveValkeyPort('')).toBe(DEFAULT_VALKEY_PORT);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('parses a valid port', () => {
    expect(resolveValkeyPort('6380')).toBe(6380);
    expect(resolveValkeyPort('1')).toBe(1);
    expect(resolveValkeyPort('65535')).toBe(65535);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('rejects non-numeric values with a loud warning naming the bad value', () => {
    expect(resolveValkeyPort('not-a-port')).toBe(DEFAULT_VALKEY_PORT);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0][0])).toContain('"not-a-port"');
  });

  it('rejects trailing garbage that parseInt would silently truncate', () => {
    // Number.parseInt('6379abc') === 6379 — the old code accepted this.
    expect(resolveValkeyPort('6379abc')).toBe(DEFAULT_VALKEY_PORT);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0][0])).toContain('"6379abc"');
  });

  it('rejects out-of-range ports', () => {
    expect(resolveValkeyPort('0')).toBe(DEFAULT_VALKEY_PORT);
    expect(resolveValkeyPort('65536')).toBe(DEFAULT_VALKEY_PORT);
    expect(resolveValkeyPort('-1')).toBe(DEFAULT_VALKEY_PORT);
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it('rejects non-integer ports', () => {
    expect(resolveValkeyPort('6379.5')).toBe(DEFAULT_VALKEY_PORT);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('never returns NaN', () => {
    for (const raw of [undefined, '', 'NaN', 'Infinity', '-Infinity', 'null', '1e400']) {
      expect(Number.isNaN(resolveValkeyPort(raw))).toBe(false);
    }
  });
});

describe('resolveValkeyConfig', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const VARS = [
    'VALKEY_HOST',
    'VALKEY_PORT',
    'VALKEY_AUTH_MODE',
    'VALKEY_CA_CERT',
    'VALKEY_TLS_INSECURE',
  ];

  beforeEach(() => {
    for (const v of VARS) {
      savedEnv[v] = process.env[v];
      delete process.env[v];
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const v of VARS) {
      if (savedEnv[v] === undefined) {
        delete process.env[v];
      } else {
        process.env[v] = savedEnv[v];
      }
    }
    vi.restoreAllMocks();
  });

  it('defaults: no host, default port, no auth', () => {
    const config = resolveValkeyConfig();
    expect(config.host).toBeNull();
    expect(config.port).toBe(DEFAULT_VALKEY_PORT);
    expect(config.authMode).toBeUndefined();
    expect(config.tlsInsecure).toBe(false);
  });

  it('uses a valid VALKEY_PORT', () => {
    process.env.VALKEY_HOST = '10.0.0.1';
    process.env.VALKEY_PORT = '6380';
    const config = resolveValkeyConfig();
    expect(config.host).toBe('10.0.0.1');
    expect(config.port).toBe(6380);
  });

  it('falls back to the default port for an invalid VALKEY_PORT (never NaN)', () => {
    process.env.VALKEY_HOST = '10.0.0.1';
    process.env.VALKEY_PORT = 'garbage';
    const config = resolveValkeyConfig();
    expect(config.port).toBe(DEFAULT_VALKEY_PORT);
    expect(Number.isNaN(config.port)).toBe(false);
    expect(console.warn).toHaveBeenCalledOnce();
  });
});

describe('RATE_LIMIT_PREFIXES', () => {
  it('declares a distinct prefix per limiter (KAN-154)', () => {
    const prefixes = Object.values(RATE_LIMIT_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
