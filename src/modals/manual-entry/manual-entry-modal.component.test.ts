import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualEntryModalComponent } from './manual-entry-modal.component';
import { PersistenceService } from '../../services/persistence.service';
import { ToastService } from '../../services/toast.service';
import { AuthService } from '../../services/auth.service';

// GH #3256 (KAN-144): "Chef's Notes" here are the user's own text, but they
// were written into `notes` — the field KAN-140 froze as generated,
// publicly-rendered, read-only content. They belong in personalNotes.
describe('ManualEntryModalComponent', () => {
  let saveRecipe: ReturnType<typeof vi.fn>;
  let toastShow: ReturnType<typeof vi.fn>;
  let ensureGuestSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    saveRecipe = vi.fn().mockResolvedValue({ ok: true });
    toastShow = vi.fn();
    ensureGuestSession = vi.fn();
  });

  const createComponent = () => {
    const injector = Injector.create({
      providers: [
        { provide: PersistenceService, useValue: { saveRecipeDetailed: saveRecipe } },
        { provide: ToastService, useValue: { show: toastShow } },
        { provide: AuthService, useValue: { ensureGuestSession } },
      ],
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

  // KAN-333: the modal closed on any outcome, so a manual recipe saved during
  // the write pause or a failed sync looked stored on the account.
  describe('when the save does not reach the server (KAN-333)', () => {
    const saveNamed = async () => {
      const component = createComponent();
      component.open();
      component.manualRecipe.update((r) => ({ ...r, name: 'Grandma Cornbread' }));
      await component.save();
      return component;
    };

    it('says nothing when the save lands', async () => {
      await saveNamed();
      expect(toastShow).not.toHaveBeenCalled();
    });

    it('says the recipe is not synced while recipe writes are paused', async () => {
      saveRecipe.mockResolvedValue({ ok: false, refusal: 'paused' });
      await saveNamed();
      expect(toastShow).toHaveBeenCalledOnce();
      expect(toastShow.mock.calls[0][0]).toMatch(/not synced/i);
      expect(toastShow.mock.calls[0][0]).toMatch(/maintenance|few minutes/i);
    });

    it('says the recipe is not synced when the sync fails', async () => {
      saveRecipe.mockResolvedValue({ ok: false, refusal: 'sync' });
      await saveNamed();
      expect(toastShow).toHaveBeenCalledOnce();
      expect(toastShow.mock.calls[0][0]).toMatch(/not synced/i);
    });

    it('keeps the form open when there was no session, so nothing was saved', async () => {
      saveRecipe.mockResolvedValue({ ok: true, noSession: true });
      const component = await saveNamed();
      expect(toastShow).toHaveBeenCalledOnce();
      expect(toastShow.mock.calls[0][0]).toMatch(/not saved/i);
      expect(component.isOpen()).toBe(true);
    });

    // A reload would discard the form, the only copy of the recipe. Ask for a
    // session instead (deferred until the startup auth check settles), so
    // saving again from the open form can land.
    it('asks for a session and says to save again, not to reload', async () => {
      saveRecipe.mockResolvedValue({ ok: true, noSession: true });
      await saveNamed();
      expect(ensureGuestSession).toHaveBeenCalledOnce();
      expect(toastShow.mock.calls[0][0]).not.toMatch(/reload/i);
      expect(toastShow.mock.calls[0][0]).toMatch(/save again/i);
    });
  });
});
