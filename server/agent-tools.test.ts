import { describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { isAgentGenerationPath, mountGenerationLimiter } from './agent-tools.js';
import { createExpensiveOperationLimiter } from './security.js';

describe('isAgentGenerationPath', () => {
  it.each([
    '/agent/tools/generate_recipe',
    '/agent/tools/generate_recipe_image',
    '/agent/tools/generate_anything_added_later',
    '/agent/tools/generate%5Frecipe',
    '/%61gent/tools/generate_recipe',
    '/agent/tools/%E0%A4%A',
  ])('matches %s', (path) => {
    expect(isAgentGenerationPath(path)).toBe(true);
  });

  it.each([
    '/agent/tools',
    '/agent/tools/search_recipes',
    '/agent/tools/get_recipe',
    '/agent/tools/get_generation_status',
    '/generate',
    '/recipes',
  ])('does not match %s', (path) => {
    expect(isAgentGenerationPath(path)).toBe(false);
  });
});

/**
 * Mount-level, as in rate-limit-mount.test.ts: Express produces the request,
 * so the /api mount and the path match are checked together.
 */
describe('the expensive-operation limit on agent generation tools (KAN-401)', () => {
  async function boot() {
    const app = express();
    // max=2 so exhaustion is cheap; the real budget is 20 per hour.
    mountGenerationLimiter(app, createExpensiveOperationLimiter(null, 60_000, 2));
    app.use('/api', (_req, res) => res.status(200).json({ ok: true }));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return {
      post: async (path: string) =>
        (await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST' })).status,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it('meters text and image generation against one budget, encoded or not', async () => {
    const { post, close } = await boot();
    try {
      expect(await post('/api/agent/tools/generate_recipe')).toBe(200);
      expect(await post('/api/agent/tools/generate_recipe_image')).toBe(200);
      expect(await post('/api/agent/tools/generate_recipe')).toBe(429);
      expect(await post('/api/agent/tools/generate%5Frecipe')).toBe(429);
    } finally {
      await close();
    }
  });

  it('shares the budget with the web generation routes without Valkey', async () => {
    const { post, close } = await boot();
    try {
      expect(await post('/api/generate')).toBe(200);
      expect(await post('/api/generate_image')).toBe(200);
      expect(await post('/api/agent/tools/generate_recipe')).toBe(429);
      expect(await post('/api/generate')).toBe(429);
    } finally {
      await close();
    }
  });

  it('meters the web generation routes on the decoded path', async () => {
    const { post, close } = await boot();
    try {
      expect(await post('/api/%67enerate')).toBe(200);
      expect(await post('/api/generate%5Fimage')).toBe(200);
      expect(await post('/api/%67enerate')).toBe(429);
      expect(await post('/api/generate')).toBe(429);
    } finally {
      await close();
    }
  });

  it('does not meter other API routes', async () => {
    const { post, close } = await boot();
    try {
      for (let i = 0; i < 5; i++) {
        expect(await post('/api/recipes')).toBe(200);
        expect(await post('/api/generated')).toBe(200);
      }
    } finally {
      await close();
    }
  });

  it('does not meter the read tools', async () => {
    const { post, close } = await boot();
    try {
      for (let i = 0; i < 5; i++) {
        expect(await post('/api/agent/tools/search_recipes')).toBe(200);
        expect(await post('/api/agent/tools/get_generation_status')).toBe(200);
      }
    } finally {
      await close();
    }
  });
});
