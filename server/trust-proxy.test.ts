import { describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_LB_IP, applyTrustProxy, trustProxyFor } from './trust-proxy.js';

// KAN-307. The test socket peer (127.0.0.1) stands in for Cloud Run's front end (hop 0).
const LB = DEFAULT_LB_IP;
const CLIENT = '203.0.113.7';
const INTERNAL_CALLER = '10.128.0.40';

async function ipSeen(configure: (app: express.Express) => void, xff: string): Promise<string> {
  const app = express();
  configure(app);
  app.get('/ip', (req, res) => {
    res.type('text').send(req.ip);
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ip`, { headers: { 'X-Forwarded-For': xff } });
    return await res.text();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const policy = (app: express.Express) => applyTrustProxy(app, LB);

describe('trust proxy policy (KAN-307)', () => {
  it('resolves an ALB request to the visitor, not the load balancer', async () => {
    expect(await ipSeen(policy, `${CLIENT}, ${LB}`)).toBe(CLIENT);
  });

  it('ignores a client-supplied X-Forwarded-For prefix on the ALB path', async () => {
    expect(await ipSeen(policy, `198.51.100.9, ${CLIENT}, ${LB}`)).toBe(CLIENT);
  });

  it('resolves a direct internal caller to its own address, not a value it supplied', async () => {
    // Shorter path: no LB hop. A plain count of 2 would return the spoofed 198.51.100.9.
    expect(await ipSeen(policy, `198.51.100.9, ${INTERNAL_CALLER}`)).toBe(INTERNAL_CALLER);
    expect(
      await ipSeen((app) => app.set('trust proxy', 2), `198.51.100.9, ${INTERNAL_CALLER}`)
    ).toBe('198.51.100.9');
  });

  it('documents the original bug: one hop resolves every visitor to the LB', async () => {
    expect(await ipSeen((app) => app.set('trust proxy', 1), `${CLIENT}, ${LB}`)).toBe(LB);
  });

  it('trusts hop 0 always and hop 1 only when it is the LB', () => {
    const trust = trustProxyFor(LB);
    expect(trust('169.254.1.1', 0)).toBe(true);
    expect(trust(LB, 1)).toBe(true);
    expect(trust(INTERNAL_CALLER, 1)).toBe(false);
    expect(trust(LB, 2)).toBe(false);
  });
});
