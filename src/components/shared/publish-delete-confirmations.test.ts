/**
 * KAN-289 — confirmation before a recipe's public page goes away.
 *
 * Adam's decision (2026-09-28, GH tasteslikegood.com#287), after the zucchini
 * poppers page was stranded: the SPA dropped the recipe from the kitchen before
 * the server answered, so a still-public row lost the toggle that unpublishes it.
 *
 *  - Unpublish: a dialog with an "Unpublish this recipe anyway" checkbox.
 *  - Delete a published recipe: refused, message only, no shortcut.
 *  - Delete a once-published recipe: irreversible warning, type the slug.
 *  - Delete a never-published recipe: the ordinary recycle-bin confirmation.
 *  - Nothing leaves the kitchen until the server agreed to the DELETE.
 */
import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  DELETE_PUBLISHED_REFUSAL,
  DELETE_SYNC_FAILURE,
  PersistenceService,
  interpretDeleteResponse,
} from '../../services/persistence.service';
import { deleteModeFor, retiringConfirmationText } from '../kitchen/kitchen.component';
import { hasEverBeenPublished, recipeFromRow, type RecipeRow } from '../../utils/recipe-row';
import type { Recipe } from '../../recipe.types';

const recipe = (over: Partial<Recipe> = {}): Recipe =>
  ({ id: 'r1', name: 'Vegan Zucchini Poppers', ...over }) as Recipe;

const res = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (body === undefined) throw new SyntaxError('no body');
    return body;
  },
});

describe('interpretDeleteResponse', () => {
  it('lets the local delete proceed on success', async () => {
    expect(await interpretDeleteResponse(res(200, {}))).toEqual({ ok: true });
  });

  it('treats 404 as already gone server-side', async () => {
    expect(await interpretDeleteResponse(res(404, { error: 'Recipe not found' }))).toEqual({
      ok: true,
    });
  });

  it('reports the KAN-288 409 as a refusal carrying the server text', async () => {
    const outcome = await interpretDeleteResponse(res(409, { error: 'Unpublish it first.' }));
    expect(outcome).toEqual({ ok: false, message: 'Unpublish it first.' });
  });

  it('falls back to the client refusal text when the 409 has no body', async () => {
    expect(await interpretDeleteResponse(res(409))).toEqual({
      ok: false,
      message: DELETE_PUBLISHED_REFUSAL,
    });
  });

  it('never reads a server error as success', async () => {
    for (const status of [401, 403, 500, 502]) {
      expect(await interpretDeleteResponse(res(status, {})), String(status)).toEqual({
        ok: false,
        message: DELETE_SYNC_FAILURE,
      });
    }
  });
});

describe('PersistenceService.deleteRecipe ordering', () => {
  // The real service registers an effect() in its constructor, so call the
  // method against a minimal `this` instead (same reason as interpretSaveResponse).
  const run = (fetchImpl: () => Promise<unknown>) => {
    const auth = { currentUser: () => ({ savedRecipes: [] }), deleteRecipe: vi.fn() };
    const self = { auth, _fetch: vi.fn(fetchImpl) };
    const call = PersistenceService.prototype.deleteRecipe.call(
      self as unknown as PersistenceService,
      'r1'
    );
    return { auth, self, call };
  };

  it('keeps the recipe (and its cookbook membership) when the server refuses', async () => {
    const { auth, call } = run(async () => res(409, { error: 'published' }));
    expect(await call).toEqual({ ok: false, message: 'published' });
    expect(auth.deleteRecipe).not.toHaveBeenCalled();
  });

  it('keeps the recipe when the request never reaches the server', async () => {
    const { auth, call } = run(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await call).toEqual({ ok: false, message: DELETE_SYNC_FAILURE });
    expect(auth.deleteRecipe).not.toHaveBeenCalled();
  });

  it('moves the recipe to the recycle bin only after the server deleted it', async () => {
    const { auth, self, call } = run(async () => res(200, {}));
    expect(await call).toEqual({ ok: true });
    expect(self._fetch).toHaveBeenCalledWith('/api/recipes/r1', { method: 'DELETE' });
    expect(auth.deleteRecipe).toHaveBeenCalledWith('r1');
  });
});

describe('deleteModeFor', () => {
  it('refuses a published recipe', () => {
    expect(deleteModeFor(recipe({ is_public: true, slug: 'vegan-zucchini-poppers' }))).toBe(
      'published'
    );
  });

  it('asks for the irreversible confirmation once a recipe has been published', () => {
    expect(
      deleteModeFor(
        recipe({
          is_public: false,
          slug: 'vegan-zucchini-poppers',
          first_published_at: '2026-08-12T10:00:00',
        })
      )
    ).toBe('retiring');
  });

  it('uses the recycle bin confirmation for a never-published recipe', () => {
    expect(deleteModeFor(recipe({ first_published_at: null }))).toBe('bin');
  });

  it('asks for the slug, or the name when a published recipe somehow has none', () => {
    expect(retiringConfirmationText(recipe({ slug: 'vegan-zucchini-poppers' }))).toBe(
      'vegan-zucchini-poppers'
    );
    expect(retiringConfirmationText(recipe({ first_published_at: '2026-08-12' }))).toBe(
      'Vegan Zucchini Poppers'
    );
  });
});

describe('hasEverBeenPublished', () => {
  it('trusts first_published_at when the Backend sends it', () => {
    expect(hasEverBeenPublished({ first_published_at: '2026-08-12' })).toBe(true);
    // A private row can carry an unvalidated payload slug; the column wins.
    expect(hasEverBeenPublished({ first_published_at: null, slug: 'x' })).toBe(false);
  });

  it('falls back to slug or public flag on a Backend predating the column', () => {
    expect(hasEverBeenPublished({ slug: 'vegan-zucchini-poppers' })).toBe(true);
    expect(hasEverBeenPublished({ is_public: true })).toBe(true);
    expect(hasEverBeenPublished({})).toBe(false);
  });

  it('comes through recipeFromRow from the row, not the blob', () => {
    const row = {
      id: 'r1',
      data: recipe(),
      slug: 'vegan-zucchini-poppers',
      is_public: false,
      is_canonical: false,
      first_published_at: '2026-08-12T10:00:00',
    } as RecipeRow;
    expect(recipeFromRow(row).first_published_at).toBe('2026-08-12T10:00:00');

    const { first_published_at: _omit, ...legacy } = row;
    void _omit;
    expect('first_published_at' in recipeFromRow(legacy as RecipeRow)).toBe(false);
  });
});

describe('dialog templates', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('renders the unpublish dialog on every surface with a publish toggle', () => {
    for (const rel of [
      '../generator/generator.component.html',
      '../recipe-detail/recipe-detail.component.html',
    ]) {
      const html = read(rel);
      expect(html, rel).toMatch(
        /<app-unpublish-confirm[\s\S]*\(confirmed\)="confirmUnpublish\(\)"/
      );
      expect(html, rel).toMatch(/\(cancelled\)="cancelUnpublish\(\)"/);
    }
  });

  it('keeps Unpublish disabled until the checkbox is ticked', () => {
    const src = read('./unpublish-confirm.component.ts');
    expect(src).toContain('Unpublish this recipe anyway');
    expect(src).toMatch(/\(click\)="confirmed\.emit\(\)"\s+\[disabled\]="!acknowledged\(\)"/);
  });

  it('offers no shortcut from the published-delete refusal', () => {
    const html = read('../kitchen/kitchen.component.html');
    const published = html.slice(
      html.indexOf("@case ('published')"),
      html.indexOf("@case ('retiring')")
    );
    expect(published).toContain('Unpublish');
    expect(published).not.toMatch(/<a\b|routerLink|togglePublic|\(click\)/);
    expect(html).toContain('This action is NOT reversible.');
    expect(html).toMatch(/\[disabled\]="!canConfirmDelete\(\)"/);
  });
});
