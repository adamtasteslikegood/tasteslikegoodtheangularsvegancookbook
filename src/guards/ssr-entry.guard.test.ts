import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router, type ActivatedRouteSnapshot, type UrlTree } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ssrEntryGuard } from './ssr-entry.guard';
import { SsrEntryService } from '../services/ssr-entry.service';

describe('ssrEntryGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const runGuard = (opts: {
    queryParams?: Record<string, unknown>;
    fragment?: string | null;
    handleSave?: ReturnType<typeof vi.fn>;
    handleAuth?: ReturnType<typeof vi.fn>;
  }) => {
    const handleSave = opts.handleSave ?? vi.fn().mockResolvedValue(undefined);
    const handleAuth = opts.handleAuth ?? vi.fn().mockResolvedValue(undefined);
    const createUrlTree = vi.fn((commands: unknown[]) => ({ commands }) as unknown as UrlTree);
    const injector = Injector.create({
      providers: [
        { provide: Router, useValue: { createUrlTree } },
        { provide: SsrEntryService, useValue: { handleSave, handleAuth } },
      ],
    });
    const route = {
      queryParams: opts.queryParams ?? {},
      fragment: opts.fragment ?? null,
    } as unknown as ActivatedRouteSnapshot;
    const result = runInInjectionContext(injector, () => ssrEntryGuard(route, {} as never));
    return { result, handleSave, handleAuth, createUrlTree };
  };

  it('kicks off the save and redirects to /kitchen without waiting on it', () => {
    let resolveSave!: () => void;
    const handleSave = vi.fn(() => new Promise<void>((resolve) => (resolveSave = resolve)));

    const { result, createUrlTree } = runGuard({
      queryParams: { save: 'thai-peanut-noodles' },
      handleSave,
    });

    expect(handleSave).toHaveBeenCalledWith('thai-peanut-noodles');
    expect(createUrlTree).toHaveBeenCalledWith(['/kitchen']);
    expect(result).toEqual({ commands: ['/kitchen'] });
    resolveSave();
  });

  it('uses the first value when the save param is repeated', () => {
    const { handleSave } = runGuard({ queryParams: { save: ['first-slug', 'second-slug'] } });

    expect(handleSave).toHaveBeenCalledWith('first-slug');
  });

  it('still redirects to /kitchen when the save rejects, logging the error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handleSave = vi.fn().mockRejectedValue(new Error('network down'));

    const { result } = runGuard({ queryParams: { save: 'some-recipe' }, handleSave });

    expect(result).toEqual({ commands: ['/kitchen'] });
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('SSR save failed:', expect.any(Error));
    });
  });

  it('handles the OAuth return and redirects to /', async () => {
    const { result, handleAuth } = runGuard({ queryParams: { auth: 'success' } });

    expect(handleAuth).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ commands: ['/'] });
  });

  it('lets save take precedence when save and auth=success are both present', () => {
    const { result, handleSave, handleAuth } = runGuard({
      queryParams: { save: 'some-recipe', auth: 'success' },
    });

    expect(handleSave).toHaveBeenCalledWith('some-recipe');
    expect(handleAuth).not.toHaveBeenCalled();
    expect(result).toEqual({ commands: ['/kitchen'] });
  });

  it('redirects the legacy #kitchen fragment to /kitchen', () => {
    const { result, handleSave, handleAuth } = runGuard({ fragment: 'kitchen' });

    expect(handleSave).not.toHaveBeenCalled();
    expect(handleAuth).not.toHaveBeenCalled();
    expect(result).toEqual({ commands: ['/kitchen'] });
  });

  it('activates normally when no SSR entry params are present', () => {
    const { result, createUrlTree } = runGuard({});

    expect(result).toBe(true);
    expect(createUrlTree).not.toHaveBeenCalled();
  });
});
