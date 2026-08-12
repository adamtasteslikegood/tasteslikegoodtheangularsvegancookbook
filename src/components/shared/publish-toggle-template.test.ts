/**
 * RCP-74 — the publish toggle must be marked unavailable for saved copies
 * (`publishToggleKind === 'source'`) on EVERY surface that renders it.
 *
 * The regression this pins: #3391 gated recipe-detail but not the generator,
 * so a saved copy viewed there rendered `aria-disabled="false"` with a normal
 * cursor — operable to assistive tech — while togglePublic() silently refused
 * the click (Copilot 3750444485 / review 4897847561 item 2 / Codex P3).
 *
 * Asserted against the template source, the same way app-shell.test.ts pins
 * index.html: the Vitest job runs no Angular build, and the class-level tests
 * already cover togglePublic() itself — what they cannot see is whether each
 * template wired the disabled state, which is precisely per-surface markup.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SURFACES = [
  ['generator', '../generator/generator.component.html'],
  ['recipe-detail', '../recipe-detail/recipe-detail.component.html'],
] as const;

/** The publish toggle is the only `role="switch"` on each surface. */
function publishToggle(html: string): string {
  const buttons = html.match(/<button\b[^>]*>/gs) ?? [];
  const switches = buttons.filter((b) => b.includes('role="switch"'));
  expect(switches, 'exactly one publish toggle per surface').toHaveLength(1);
  return switches[0];
}

function binding(tag: string, name: string): string {
  const match = tag.match(
    new RegExp(`\\[${name.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}\\]="([^"]*)"`)
  );
  expect(match, `publish toggle must bind [${name}]`).not.toBeNull();
  return match![1];
}

/** The publishToggleKind comparisons an expression gates on, e.g. {'locked','manual'}. */
function gatedKinds(expression: string): Set<string> {
  return new Set(
    [...expression.matchAll(/publishToggleKind\(r\)\s*===\s*'([a-z]+)'/g)].map((m) => m[1])
  );
}

describe.each(SURFACES)('publish toggle template gating: %s', (_surface, relPath) => {
  const html = readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
  const toggle = publishToggle(html);

  it("marks 'source' recipes aria-disabled (RCP-74)", () => {
    const kinds = gatedKinds(binding(toggle, 'attr.aria-disabled'));
    expect(kinds).toEqual(new Set(['locked', 'manual', 'source']));
    // The pending-sync state disables the toggle too (KAN-139).
    expect(binding(toggle, 'attr.aria-disabled')).toContain('publishTogglePending()');
  });

  it("shows cursor-not-allowed for 'source' recipes (RCP-74)", () => {
    expect(gatedKinds(binding(toggle, 'class.cursor-not-allowed'))).toEqual(
      new Set(['locked', 'manual', 'source'])
    );
  });
});

it('the two surfaces gate the same kinds — neither can drift alone', () => {
  const [genToggle, detailToggle] = SURFACES.map(([, relPath]) =>
    publishToggle(readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8'))
  );
  for (const name of ['attr.aria-disabled', 'class.cursor-not-allowed']) {
    expect(gatedKinds(binding(genToggle, name))).toEqual(gatedKinds(binding(detailToggle, name)));
  }
});
