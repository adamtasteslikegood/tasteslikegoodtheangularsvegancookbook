import { describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { TRUST_PROXY_HOPS } from './trust-proxy.js';

// KAN-307: behind the external ALB, X-Forwarded-For ends "<client>, <lb>".
const LB = '34.8.251.224';
const CLIENT = '203.0.113.7';

async function ipSeenWith(hops: number, xff: string): Promise<string> {
  const app = express();
  app.set('trust proxy', hops);
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

describe('TRUST_PROXY_HOPS (KAN-307)', () => {
  it('resolves req.ip to the visitor, not the load balancer', async () => {
    expect(await ipSeenWith(TRUST_PROXY_HOPS, `${CLIENT}, ${LB}`)).toBe(CLIENT);
  });

  it('ignores a client-supplied X-Forwarded-For prefix', async () => {
    expect(await ipSeenWith(TRUST_PROXY_HOPS, `198.51.100.9, ${CLIENT}, ${LB}`)).toBe(CLIENT);
  });

  it('documents the bug: one hop resolves every visitor to the LB address', async () => {
    expect(await ipSeenWith(1, `${CLIENT}, ${LB}`)).toBe(LB);
  });
});
