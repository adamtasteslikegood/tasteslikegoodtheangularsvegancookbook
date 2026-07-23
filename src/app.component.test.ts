import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { ManualEntryModalComponent } from './modals/manual-entry/manual-entry-modal.component';
import { CreateCookbookModalComponent } from './modals/create-cookbook/create-cookbook-modal.component';
import { PersistenceService } from './services/persistence.service';

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
