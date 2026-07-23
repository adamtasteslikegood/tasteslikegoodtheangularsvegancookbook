import { describe, expect, it } from 'vitest';
import { isInAppBrowser } from './in-app-browser';

describe('isInAppBrowser', () => {
  it('returns false for empty / missing user agents', () => {
    expect(isInAppBrowser('')).toBe(false);
    expect(isInAppBrowser(null)).toBe(false);
    expect(isInAppBrowser(undefined)).toBe(false);
  });

  it('detects the Pinterest in-app browser', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]';
    expect(isInAppBrowser(ua)).toBe(true);
  });

  it('detects the Facebook in-app browser', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0]';
    expect(isInAppBrowser(ua)).toBe(true);
  });

  it('detects the Instagram in-app browser', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0';
    expect(isInAppBrowser(ua)).toBe(true);
  });

  it('detects a generic Android System WebView (wv token)', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36';
    expect(isInAppBrowser(ua)).toBe(true);
  });

  it('returns false for real mobile Safari', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    expect(isInAppBrowser(ua)).toBe(false);
  });

  it('returns false for real Chrome on Android (no wv token)', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/126.0.0.0 Mobile Safari/537.36';
    expect(isInAppBrowser(ua)).toBe(false);
  });

  it('returns false for desktop Chrome', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/126.0.0.0 Safari/537.36';
    expect(isInAppBrowser(ua)).toBe(false);
  });
});
