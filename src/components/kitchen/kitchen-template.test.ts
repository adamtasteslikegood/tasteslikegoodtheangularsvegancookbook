/**
 * KAN-330 — the kitchen offers no recipe import.
 *
 * Importing a JSON file was a way to put arbitrary content into a recipe row,
 * so the control and the copy that pointed at it are gone. Pinned against the
 * template source (the Vitest job runs no Angular build), the way
 * publish-toggle-template.test.ts pins the toggle gating.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(
  fileURLToPath(new URL('./kitchen.component.html', import.meta.url)),
  'utf8'
);

describe('kitchen template', () => {
  it('has no file input', () => {
    expect(html).not.toMatch(/type="file"/);
  });

  it('mentions no import anywhere', () => {
    expect(html).not.toMatch(/import/i);
  });

  it('still offers export', () => {
    expect(html).toMatch(/exportRecipe\(\)/);
  });
});
