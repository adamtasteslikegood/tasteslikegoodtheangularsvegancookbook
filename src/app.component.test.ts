import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { AuthService } from './services/auth.service';
import { GeminiService } from './services/gemini.service';
import { PersistenceService } from './services/persistence.service';
import { ToastService } from './services/toast.service';
import { RecipeStateService } from './services/recipe-state.service';

const mockRouter = { events: { subscribe: vi.fn() }, navigate: vi.fn() };
const mockToastService = { toasts: signal([]), show: vi.fn(), dismiss: vi.fn() };
const mockRecipeStateService = {
  currentRecipe: signal(null),
  generatedImageUrl: signal(null),
  isSaved: signal(false),
  viewRecipe: vi.fn(),
  clearRecipe: vi.fn(),
};

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
        { provide: Router, useValue: mockRouter },
        { provide: ToastService, useValue: mockToastService },
        { provide: RecipeStateService, useValue: mockRecipeStateService },
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
        { provide: Router, useValue: mockRouter },
        { provide: ToastService, useValue: mockToastService },
        { provide: RecipeStateService, useValue: mockRecipeStateService },
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

describe('AppComponent.createCookbook in-flight guard', () => {
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

  const createComponent = (createCookbookImpl: (...args: unknown[]) => Promise<string | null>) => {
    const injector = Injector.create({
      providers: [
        { provide: Router, useValue: mockRouter },
        { provide: ToastService, useValue: mockToastService },
        { provide: RecipeStateService, useValue: mockRecipeStateService },
        { provide: GeminiService, useValue: {} },
        { provide: PersistenceService, useValue: { createCookbook: vi.fn(createCookbookImpl) } },
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

  it('ignores a second call while the first request is still in flight', async () => {
    let resolveCreate!: (id: string) => void;
    const inFlight = new Promise<string>((resolve) => {
      resolveCreate = resolve;
    });
    const component = createComponent(() => inFlight);
    component.newCookbookName.set('Weeknight Dinners');

    const first = component.createCookbook();
    expect(component.isCreatingCookbook()).toBe(true);
    const second = component.createCookbook(); // should short-circuit, not fire a second request

    resolveCreate('cookbook-1');
    await Promise.all([first, second]);

    expect(
      (component['persistenceService'].createCookbook as ReturnType<typeof vi.fn>).mock.calls
    ).toHaveLength(1);
    expect(component.isCreatingCookbook()).toBe(false);
    expect(component.showCreateCookbookModal()).toBe(false);
  });

  it('resets the guard and keeps the modal open when creation is rejected', async () => {
    const component = createComponent(async () => null); // e.g. a 400/401/403 rejection
    component.newCookbookName.set('Weeknight Dinners');
    component.showCreateCookbookModal.set(true);

    await component.createCookbook();

    expect(component.isCreatingCookbook()).toBe(false);
    expect(component.showCreateCookbookModal()).toBe(true);
  });

  it('adds the server-resolved cookbook id, not a guessed one, to pendingCookbookIds', async () => {
    const component = createComponent(async () => 'resolved-id');
    component.newCookbookName.set('Weeknight Dinners');
    component['_creatingFromAddFlow'] = true;

    await component.createCookbook();

    expect(component.pendingCookbookIds().has('resolved-id')).toBe(true);
    expect(component.showCreateCookbookModal()).toBe(false);
  });
});

// save-from-SSR dedup tests moved to src/services/ssr-entry.service.test.ts (T3)
