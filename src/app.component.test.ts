import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorComponent } from './components/generator/generator.component';
import { ManualEntryModalComponent } from './modals/manual-entry/manual-entry-modal.component';
import { CreateCookbookModalComponent } from './modals/create-cookbook/create-cookbook-modal.component';
import { AuthService } from './services/auth.service';
import { GeminiService } from './services/gemini.service';
import { PersistenceService } from './services/persistence.service';
import { RecipeStateService } from './services/recipe-state.service';

const mockRouter = { events: { subscribe: vi.fn() }, navigate: vi.fn() };
const mockRecipeStateService = {
  currentRecipe: signal(null),
  generatedImageUrl: signal(null),
  isSaved: signal(false),
  viewRecipe: vi.fn(),
  clearRecipe: vi.fn(),
};

describe('ManualEntryModalComponent reopened session resets drafts', () => {
  it('starts a reopened manual-entry session with empty ingredient and instruction drafts', () => {
    const injector = Injector.create({
      providers: [{ provide: PersistenceService, useValue: {} }],
    });
    const component = runInInjectionContext(injector, () => new ManualEntryModalComponent());

    component.open();
    component.newIngredient.set({
      name: 'Stale tofu',
      amount: 2,
      units: 'blocks',
      type: 'wet',
    });
    component.newInstruction.set('Carry this into the next recipe');
    component.close();

    component.open();

    expect(component.newIngredient()).toEqual({
      name: '',
      amount: 1,
      units: '',
      type: 'dry',
    });
    expect(component.newInstruction()).toBe('');
  });
});

describe('GeneratorComponent slugFromTitle parity with Backend normalize_slug', () => {
  const createGenerator = () => {
    const injector = Injector.create({
      providers: [
        { provide: Router, useValue: mockRouter },
        { provide: RecipeStateService, useValue: mockRecipeStateService },
        { provide: GeminiService, useValue: {} },
        { provide: PersistenceService, useValue: {} },
        {
          provide: AuthService,
          useValue: {
            ensureGuestSession: vi.fn(),
            currentUser: signal(null),
            ready: Promise.resolve(),
          },
        },
      ],
    });
    return runInInjectionContext(injector, () => new GeneratorComponent());
  };

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
    const component = createGenerator();
    expect(component['slugFromTitle'](title)).toBe(expected);
  });
});

describe('CreateCookbookModalComponent in-flight guard', () => {
  const createComponent = (createCookbookImpl: (...args: unknown[]) => Promise<string | null>) => {
    const injector = Injector.create({
      providers: [
        { provide: PersistenceService, useValue: { createCookbook: vi.fn(createCookbookImpl) } },
      ],
    });
    return runInInjectionContext(injector, () => new CreateCookbookModalComponent());
  };

  it('ignores a second call while the first request is still in flight', async () => {
    let resolveCreate!: (id: string) => void;
    const inFlight = new Promise<string>((resolve) => {
      resolveCreate = resolve;
    });
    const component = createComponent(() => inFlight);
    component.newCookbookName.set('Weeknight Dinners');

    const first = component.create();
    expect(component.isCreatingCookbook()).toBe(true);
    const second = component.create();

    resolveCreate('cookbook-1');
    await Promise.all([first, second]);

    expect(
      (component['persistenceService'].createCookbook as ReturnType<typeof vi.fn>).mock.calls
    ).toHaveLength(1);
    expect(component.isCreatingCookbook()).toBe(false);
    expect(component.isOpen()).toBe(false);
  });

  it('resets the guard and keeps the modal open when creation is rejected', async () => {
    const component = createComponent(async () => null);
    component.newCookbookName.set('Weeknight Dinners');
    component.isOpen.set(true);

    await component.create();

    expect(component.isCreatingCookbook()).toBe(false);
    expect(component.isOpen()).toBe(true);
  });

  it('emits cookbookCreated with the server-resolved id', async () => {
    const component = createComponent(async () => 'resolved-id');
    component.newCookbookName.set('Weeknight Dinners');
    component.isOpen.set(true);

    let emittedId: string | undefined;
    component.cookbookCreated.subscribe((id) => {
      emittedId = id;
    });

    await component.create();

    expect(emittedId).toBe('resolved-id');
    expect(component.isOpen()).toBe(false);
  });
});

// save-from-SSR dedup tests moved to src/services/ssr-entry.service.test.ts (T3)
