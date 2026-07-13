import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { AuthService } from './services/auth.service';
import { GeminiService } from './services/gemini.service';
import { PersistenceService } from './services/persistence.service';

describe('AppComponent manual recipe entry', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      location: {
        hash: '',
        href: 'http://localhost/',
        pathname: '/',
        search: '',
      },
      history: {
        replaceState: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts a reopened manual-entry session with empty ingredient and instruction drafts', () => {
    const injector = Injector.create({
      providers: [
        { provide: GeminiService, useValue: {} },
        { provide: PersistenceService, useValue: {} },
        {
          provide: AuthService,
          useValue: {
            ensureGuestSession: vi.fn(),
            ready: Promise.resolve(),
          },
        },
      ],
    });
    const component = runInInjectionContext(injector, () => new AppComponent());

    component.openManualEntryModal();
    component.newIngredient.set({
      name: 'Stale tofu',
      amount: 2,
      units: 'blocks',
      type: 'wet',
    });
    component.newInstruction.set('Carry this into the next recipe');
    component.closeManualEntryModal();

    component.openManualEntryModal();

    expect(component.newIngredient()).toEqual({
      name: '',
      amount: 1,
      units: '',
      type: 'dry',
    });
    expect(component.newInstruction()).toBe('');
  });
});
