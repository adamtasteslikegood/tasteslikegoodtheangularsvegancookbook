import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { ManualEntryModalComponent } from './modals/manual-entry/manual-entry-modal.component';
import { CreateCookbookModalComponent } from './modals/create-cookbook/create-cookbook-modal.component';
import { PersistenceService } from './services/persistence.service';
import { AppComponent } from './app.component';

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

// slugFromTitle parity tests moved to src/utils/slug.test.ts (T6)

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

// KAN-344: Switch user logs out first, so a sign-in that cannot start must not
// strand the user on a logged-out page with no way forward.
describe('AppComponent switch user (KAN-344)', () => {
  // The component's constructor registers an effect, which needs the full
  // Angular runtime; the handler only reads these four collaborators.
  const createApp = (switchUser: () => Promise<void>) => {
    const navigate = vi.fn();
    const openAuth = vi.fn();
    const clearRecipe = vi.fn();
    const self = {
      router: { navigate },
      authService: { switchUser: vi.fn(switchUser) },
      recipeState: { clearRecipe },
      modalService: { openAuth },
    };
    const component = {
      onSwitchUser: () => AppComponent.prototype.onSwitchUser.call(self as unknown as AppComponent),
    };
    return { component, navigate, openAuth, clearRecipe };
  };

  it('leaves the page alone when the chooser sign-in starts', async () => {
    const { component, navigate, openAuth, clearRecipe } = createApp(async () => {});

    await component.onSwitchUser();

    expect(clearRecipe).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(openAuth).not.toHaveBeenCalled();
  });

  it('goes home and reopens sign-in when the chooser sign-in cannot start', async () => {
    const { component, navigate, openAuth } = createApp(async () => {
      throw new Error('Failed to initiate login');
    });

    await component.onSwitchUser();

    expect(navigate).toHaveBeenCalledWith(['/']);
    expect(openAuth).toHaveBeenCalled();
  });
});
