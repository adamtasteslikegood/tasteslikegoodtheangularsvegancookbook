/**
 * Datadog RUM plumbing (KAN-292 / RCP-101): runtime config, the same-origin
 * intake proxy, and the CSP invariant the proxy exists to protect.
 */
import { describe, expect, it, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  RUM_INTAKE_ORIGIN,
  buildUpstreamUrl,
  createRumRouter,
  resolveRumConfig,
  type RumConfig,
} from './rum.js';
import { applySecurityMiddleware } from './security.js';

const CONFIG: RumConfig = {
  enabled: true,
  applicationId: 'app-123',
  clientToken: 'pub-token',
  sessionSampleRate: 50,
  env: 'production',
  service: 'tasteslikegood-web',
  version: '9.9.9',
};

const passThrough = (_req: Request, _res: Response, next: NextFunction) => next();

async function boot(config: RumConfig | null, fetchImpl?: typeof fetch) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createRumRouter({ config, intakeLimiter: passThrough, fetchImpl }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function forwardParam(query: string): string {
  return encodeURIComponent(`/api/v2/rum?${query}`);
}

describe('resolveRumConfig', () => {
  it('is null (RUM off) until both the application id and client token are set', () => {
    expect(resolveRumConfig({})).toBeNull();
    expect(resolveRumConfig({ DATADOG_RUM_APPLICATION_ID: 'a' })).toBeNull();
    expect(resolveRumConfig({ DATADOG_RUM_CLIENT_TOKEN: 't' })).toBeNull();
    expect(
      resolveRumConfig({ DATADOG_RUM_APPLICATION_ID: ' ', DATADOG_RUM_CLIENT_TOKEN: 't' })
    ).toBeNull();
  });

  it('reads ids, clamps the sample rate, and defaults env/service', () => {
    const cfg = resolveRumConfig(
      {
        DATADOG_RUM_APPLICATION_ID: 'app',
        DATADOG_RUM_CLIENT_TOKEN: 'tok',
        DATADOG_RUM_SESSION_SAMPLE_RATE: '250',
      },
      '1.2.3'
    );
    expect(cfg).toEqual({
      enabled: true,
      applicationId: 'app',
      clientToken: 'tok',
      sessionSampleRate: 100,
      env: 'production',
      service: 'tasteslikegood-web',
      version: '1.2.3',
    });
    expect(
      resolveRumConfig({
        DATADOG_RUM_APPLICATION_ID: 'a',
        DATADOG_RUM_CLIENT_TOKEN: 't',
        DATADOG_RUM_SESSION_SAMPLE_RATE: '12.5',
        NODE_ENV: 'staging',
      })
    ).toMatchObject({ sessionSampleRate: 12.5, env: 'staging' });
    expect(
      resolveRumConfig({
        DATADOG_RUM_APPLICATION_ID: 'a',
        DATADOG_RUM_CLIENT_TOKEN: 't',
        DATADOG_RUM_SESSION_SAMPLE_RATE: 'nope',
      })?.sessionSampleRate
    ).toBe(100);
  });
});

describe('buildUpstreamUrl', () => {
  const ok = '/api/v2/rum?ddsource=browser&dd-api-key=pub-token&batch_time=1';

  it('forwards only /api/v2/rum on the us5 intake, rebuilt from constants', () => {
    expect(buildUpstreamUrl({ ddforward: ok }, 'pub-token')).toBe(
      `${RUM_INTAKE_ORIGIN}/api/v2/rum?ddsource=browser&dd-api-key=pub-token&batch_time=1`
    );
  });

  it.each([
    ['missing', {}],
    ['non-string', { ddforward: ['a', 'b'] }],
    ['replay track', { ddforward: '/api/v2/replay?dd-api-key=pub-token' }],
    ['logs track', { ddforward: '/api/v2/logs?dd-api-key=pub-token' }],
    ['absolute URL', { ddforward: 'https://evil.example/api/v2/rum?dd-api-key=pub-token' }],
    ['protocol-relative', { ddforward: '//evil.example/api/v2/rum?dd-api-key=pub-token' }],
    ['path traversal', { ddforward: '/api/v2/rum/../../x?dd-api-key=pub-token' }],
    ['subdomain forward', { ddforward: ok, ddforwardSubdomain: 'sdk-configuration' }],
    ['foreign token', { ddforward: '/api/v2/rum?ddsource=browser&dd-api-key=someone-else' }],
    [
      'duplicate token',
      { ddforward: '/api/v2/rum?dd-api-key=pub-token&dd-api-key=someone-else' },
    ],
    ['no token', { ddforward: '/api/v2/rum?ddsource=browser' }],
  ])('refuses %s', (_label, query) => {
    expect(buildUpstreamUrl(query as Request['query'], 'pub-token')).toBeNull();
  });
});

describe('RUM router', () => {
  it('GET /rum/config answers {enabled:false} when RUM is not configured', async () => {
    const srv = await boot(null);
    try {
      const res = await fetch(`${srv.url}/rum/config`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ enabled: false });
    } finally {
      await srv.close();
    }
  });

  it('GET /rum/config serves the public runtime config', async () => {
    const srv = await boot(CONFIG);
    try {
      const res = await fetch(`${srv.url}/rum/config`);
      expect(await res.json()).toEqual(CONFIG);
      expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    } finally {
      await srv.close();
    }
  });

  it('POST /rum/intake is 404 while RUM is off, and never reaches Datadog', async () => {
    const fetchImpl = vi.fn();
    const srv = await boot(null, fetchImpl as unknown as typeof fetch);
    try {
      const res = await fetch(`${srv.url}/rum/intake?ddforward=${forwardParam('dd-api-key=x')}`, {
        method: 'POST',
        body: '{}',
      });
      expect(res.status).toBe(404);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('refuses non-POST methods with 405', async () => {
    const srv = await boot(CONFIG);
    try {
      const res = await fetch(`${srv.url}/rum/intake`);
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    } finally {
      await srv.close();
    }
  });

  it('refuses a batch for another Datadog org with 400, without forwarding', async () => {
    const fetchImpl = vi.fn();
    const srv = await boot(CONFIG, fetchImpl as unknown as typeof fetch);
    try {
      const res = await fetch(
        `${srv.url}/rum/intake?ddforward=${forwardParam('dd-api-key=other-org')}`,
        { method: 'POST', body: 'x' }
      );
      expect(res.status).toBe(400);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it('forwards the raw body to the us5 intake with X-Forwarded-For and relays the status', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const srv = await boot(CONFIG, fetchImpl as unknown as typeof fetch);
    try {
      const body = '{"type":"view"}\n{"type":"action"}';
      const res = await fetch(
        `${srv.url}/rum/intake?ddforward=${forwardParam('ddsource=browser&dd-api-key=pub-token')}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'X-Forwarded-For': '203.0.113.7' },
          body,
        }
      );
      expect(res.status).toBe(202);
      expect(fetchImpl).toHaveBeenCalledOnce();
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`${RUM_INTAKE_ORIGIN}/api/v2/rum?ddsource=browser&dd-api-key=pub-token`);
      expect(init.method).toBe('POST');
      expect(Buffer.from(init.body as Uint8Array).toString()).toBe(body);
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('text/plain;charset=UTF-8');
      expect(headers['X-Forwarded-For']).toBe('203.0.113.7');
      // Only the two headers above: no cookies or auth leak to Datadog.
      expect(Object.keys(headers).sort()).toEqual(['Content-Type', 'X-Forwarded-For']);
    } finally {
      await srv.close();
    }
  });

  it('answers 502 when the intake is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down');
    });
    const srv = await boot(CONFIG, fetchImpl as unknown as typeof fetch);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await fetch(
        `${srv.url}/rum/intake?ddforward=${forwardParam('dd-api-key=pub-token')}`,
        { method: 'POST', body: 'x' }
      );
      expect(res.status).toBe(502);
    } finally {
      warn.mockRestore();
      await srv.close();
    }
  });
});

describe('CSP stays narrow with RUM (RCP-101)', () => {
  it("keeps connect-src at exactly 'self' and names no Datadog host anywhere", () => {
    const useMock = vi.fn();
    applySecurityMiddleware({ use: useMock } as unknown as Express);
    const helmetMiddleware = useMock.mock.calls[0]?.[0] as (
      req: Request,
      res: Response,
      next: NextFunction
    ) => void;
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name.toLowerCase()] = String(value);
      },
      removeHeader: vi.fn(),
      getHeader: (name: string) => headers[name.toLowerCase()],
    } as unknown as Response;
    helmetMiddleware({ headers: {} } as unknown as Request, res, vi.fn());

    const csp = headers['content-security-policy'];
    expect(csp).toMatch(/(?:^|;)connect-src 'self'(?:;|$)/);
    expect(csp).toMatch(/(?:^|;)script-src 'self' 'sha256-[^']+'(?:;|$)/);
    expect(csp).not.toMatch(/datadog|browser-intake/i);
  });
});
