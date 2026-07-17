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

describe('AppComponent slugFromTitle parity with Backend normalize_slug', () => {
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

  const createComponent = () => {
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
    return runInInjectionContext(injector, () => new AppComponent());
  };

  // Expected values are the literal output of the server implementation
  // (Backend/utils/slug_utils.normalize_slug), the authority this method
  // mirrors. Regenerate after changing either side:
  //   cd Backend && uv run python -c \
  //     "from utils.slug_utils import normalize_slug; print(normalize_slug('<title>'))"
  // Probes chosen to catch known divergence classes: characters NFKD cannot
  // decompose (ø, Ł, ß, þ, ð — deleted by the server, so no hyphen may appear
  // in their place), decomposable diacritics (é, ü, ï), non-ASCII punctuation
  // (em/en dashes — deleted, NOT collapsed to '-'), and inputs with no ASCII
  // alphanumerics at all (CJK, emoji), which yield '' and are rejected
  // server-side with 400 PUBLIC_SLUG_REQUIRED_ERROR on publish.
  const parityCases: Array<[title: string, expected: string]> = [
    ["Adam's Amazing Pasta", 'adam-s-amazing-pasta'],
    ['Café Crème Brûlée', 'cafe-creme-brulee'],
    ['Ünïcödé Fëast', 'unicode-feast'],
    ['Rødgrød med Fløde', 'rdgrd-med-flde'],
    ["Bjørn's Cookies", 'bjrn-s-cookies'],
    ['Łódź Bagels & ß-Pretzels', 'odz-bagels-pretzels'],
    ['  Leading and trailing  ', 'leading-and-trailing'],
    ['Spicy!!! Tofu??? (v2)', 'spicy-tofu-v2'],
    ['MiXeD CaSe TITLE', 'mixed-case-title'],
    ['a—b–c', 'abc'],
    ['naïve façade', 'naive-facade'],
    ['100% Vegan Chili #2', '100-vegan-chili-2'],
    ['þorramatur ðelight', 'orramatur-elight'],
    ['豆腐カレー', ''],
    ['🌮🌮🌮', ''],
  ];

  it.each(parityCases)('derives %j → %j exactly as the server would', (title, expected) => {
    const component = createComponent();
    expect(component['slugFromTitle'](title)).toBe(expected);
  });
});
