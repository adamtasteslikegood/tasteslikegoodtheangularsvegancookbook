import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryModalComponent } from './manual-entry-modal.component';
import { PersistenceService } from '../../services/persistence.service';

// GH #3256 (KAN-144): "Chef's Notes" here are the user's own text, but they
// were written into `notes` — the field KAN-140 froze as generated,
// publicly-rendered, read-only content. They belong in personalNotes.
describe('ManualEntryModalComponent', () => {
  let saveRecipe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    saveRecipe = vi.fn().mockResolvedValue(true);
  });

  const createComponent = () => {
    const injector = Injector.create({
      providers: [{ provide: PersistenceService, useValue: { saveRecipe } }],
    });
    return runInInjectionContext(injector, () => new ManualEntryModalComponent());
  };

  it('files the chef notes as private personal notes, not as generated notes', async () => {
    const component = createComponent();
    component.open();
    component.manualRecipe.update((r) => ({
      ...r,
      name: 'Grandma Cornbread',
      notes: 'skillet must be screaming hot',
    }));

    await component.save();

    expect(saveRecipe).toHaveBeenCalledOnce();
    const saved = saveRecipe.mock.calls[0][0];
    expect(saved.personalNotes).toBe('skillet must be screaming hot');
    expect(saved.notes).toBeUndefined();
  });

  it('labels the recipe as manually entered so the server can gate publishing', async () => {
    const component = createComponent();
    component.open();
    component.manualRecipe.update((r) => ({ ...r, name: 'Grandma Cornbread' }));

    await component.save();

    expect(saveRecipe.mock.calls[0][0].origin).toBe('manual');
  });
});
