import { describe, expect, it } from 'vitest';
import { staticCacheControl } from './static-cache.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';

describe('staticCacheControl (KAN-362)', () => {
  it('makes content-hashed build assets immutable for a year', () => {
    for (const file of [
      'main-7TDZDTLK.js',
      'chunk-Bbf9mHX1.js',
      'chunk-BZUN3G6W.js',
      'polyfills-5CFQRCPP.js',
      'styles-URQ2QLMQ.css',
    ]) {
      expect(staticCacheControl(file), file).toBe(IMMUTABLE);
    }
  });

  it('keeps index.html and other unhashed files revalidating', () => {
    for (const file of [
      'index.html',
      'robots.txt',
      'favicon.svg',
      'og-home.jpg',
      '3rdpartylicenses.txt',
      'main.js',
      'main-short.js',
      'other-ABCD1234.js',
      'main-7TDZDTLK.js.map',
      'nested/main-7TDZDTLK.js',
    ]) {
      expect(staticCacheControl(file), file).toBeUndefined();
    }
  });

  it('gives the unhashed RUM scripts an hour, never immutable', () => {
    expect(staticCacheControl('rum/consent.js')).toBe('public, max-age=3600');
    expect(staticCacheControl('rum/datadog-rum-slim.js')).toBe('public, max-age=3600');
    expect(staticCacheControl('rum\\consent.js')).toBe('public, max-age=3600');
    expect(staticCacheControl('rum/nested/consent.js')).toBeUndefined();
  });
});
