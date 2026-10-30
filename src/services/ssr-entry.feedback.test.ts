/**
 * KAN-356 — the feedback entry from the public page (R8, R15, O6, O8, E2).
 * The save-only behaviour of SsrEntryService is in ssr-entry.service.test.ts.
 */
import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SsrEntryService } from './ssr-entry.service';
import { AuthService } from './auth.service';
import { PersistenceService } from './persistence.service';
import { ToastService } from './toast.service';

describe('SsrEntryService feedback flow', () => {
  const store = new Map<string, string>();
  const memory = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as unknown as Storage;

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('sessionStorage', memory);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const setup = (opts: {
    signedIn: boolean;
    savedRecipes?: unknown[];
    login?: ReturnType<typeof vi.fn>;
  }) => {
    const toastShow = vi.fn();
    const navigate = vi.fn().mockResolvedValue(true);
    const login = opts.login ?? vi.fn().mockResolvedValue(undefined);
    const saveRecipeDetailed = vi.fn().mockResolvedValue({ ok: true });
    const injector = Injector.create({
      providers: [
        {
          provide: AuthService,
          useValue: {
            ready: Promise.resolve(),
            ensureGuestSession: vi.fn(),
            login,
            currentUser: () =>
              opts.signedIn
                ? { isGuest: false, authProvider: 'google', savedRecipes: opts.savedRecipes ?? [] }
                : { isGuest: true, authProvider: 'guest', savedRecipes: opts.savedRecipes ?? [] },
          },
        },
        {
          provide: PersistenceService,
          useValue: { saveRecipeDetailed, firstSyncSettled: Promise.resolve() },
        },
        { provide: ToastService, useValue: { show: toastShow } },
        { provide: Router, useValue: { navigate } },
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'pub-1',
            slug: 'thai-peanut-noodles',
            name: 'Thai Peanut Noodles',
            ingredients: [],
            instructions: [],
          }),
      })
    );
    const service = runInInjectionContext(injector, () => new SsrEntryService());
    return { service, toastShow, navigate, login, saveRecipeDetailed };
  };

  it('signed in: opens the saved copy at the form without a toast', async () => {
    const { service, navigate, toastShow, saveRecipeDetailed } = setup({
      signedIn: true,
      savedRecipes: [{ id: 'copy-1', sourceSlug: 'thai-peanut-noodles' }],
    });

    await service.handleFeedback('Thai-Peanut-Noodles');

    expect(saveRecipeDetailed).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/recipe', 'copy-1'], { fragment: 'feedback' });
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('signed in without a copy: saves it, then opens it at the form', async () => {
    const { service, navigate, saveRecipeDetailed } = setup({ signedIn: true });

    await service.handleFeedback('thai-peanut-noodles');

    expect(saveRecipeDetailed).toHaveBeenCalledTimes(1);
    const saved = saveRecipeDetailed.mock.calls[0][0];
    expect(saved.sourceRecipeId).toBe('pub-1');
    expect(navigate).toHaveBeenCalledWith(['/recipe', saved.id], { fragment: 'feedback' });
  });

  // O6: the source was renamed after the copy was saved, so the slug misses.
  it('finds a copy by the public recipe id when its sourceSlug is stale', async () => {
    const { service, navigate, saveRecipeDetailed } = setup({
      signedIn: true,
      savedRecipes: [{ id: 'copy-9', sourceSlug: 'old-name', sourceRecipeId: 'pub-1' }],
    });

    await service.handleFeedback('thai-peanut-noodles');

    expect(saveRecipeDetailed).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/recipe', 'copy-9'], { fragment: 'feedback' });
  });

  it('signed out: keeps the intent and starts Google sign-in', async () => {
    const { service, login, navigate } = setup({ signedIn: false });

    await service.handleFeedback('thai-peanut-noodles');

    expect(store.get('tlg.feedbackIntent')).toBe('{"feedback":"thai-peanut-noodles"}');
    expect(login).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('clears the intent and says so when sign-in cannot start', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { service, toastShow } = setup({
      signedIn: false,
      login: vi.fn().mockRejectedValue(new Error('down')),
    });

    await service.handleFeedback('thai-peanut-noodles');

    expect(store.has('tlg.feedbackIntent')).toBe(false);
    expect(toastShow).toHaveBeenCalledWith('Could not start sign-in. Please try again.');
  });

  it('ignores an invalid slug', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { service, login, navigate } = setup({ signedIn: false });

    await service.handleFeedback('../nope');

    expect(login).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('back from Google: honours the intent once, then never again', async () => {
    store.set('tlg.feedbackIntent', '{"feedback":"thai-peanut-noodles"}');
    const { service, navigate } = setup({
      signedIn: true,
      savedRecipes: [{ id: 'copy-1', sourceSlug: 'thai-peanut-noodles' }],
    });

    await service.handleAuth();
    await service.handleAuth();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/recipe', 'copy-1'], { fragment: 'feedback' });
  });

  it('back from Google with no intent: does nothing extra', async () => {
    const { service, navigate } = setup({ signedIn: true });

    await service.handleAuth();

    expect(navigate).not.toHaveBeenCalled();
  });

  // E2 + R8: cancelled at Google. Save as a guest and offer sign-in once more.
  it('sign-in cancelled: saves as a guest and offers a Sign in action that re-arms the intent', async () => {
    store.set('tlg.feedbackIntent', '{"feedback":"thai-peanut-noodles"}');
    const { service, toastShow, login, saveRecipeDetailed } = setup({ signedIn: false });

    await service.handleAuthCancelled();

    expect(saveRecipeDetailed).toHaveBeenCalledTimes(1);
    expect(store.has('tlg.feedbackIntent')).toBe(false);
    expect(toastShow).toHaveBeenCalledTimes(1);
    const [message, recipe, duration, link, action] = toastShow.mock.calls[0];
    expect(message).toBe('Saved to your cookbook. Sign in to add your feedback.');
    expect(recipe).toBeNull();
    expect(duration).toBe(12_000);
    expect(link).toBeUndefined();
    expect(action.label).toBe('Sign in');

    // O8: the second chance lands on the form too.
    action.run();
    await Promise.resolve();
    expect(store.get('tlg.feedbackIntent')).toBe('{"feedback":"thai-peanut-noodles"}');
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('sign-in cancelled without an intent: no save, no toast', async () => {
    const { service, toastShow, saveRecipeDetailed } = setup({ signedIn: false });

    await service.handleAuthCancelled();

    expect(saveRecipeDetailed).not.toHaveBeenCalled();
    expect(toastShow).not.toHaveBeenCalled();
  });
});
