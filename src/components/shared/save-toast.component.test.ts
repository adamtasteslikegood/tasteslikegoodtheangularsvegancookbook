/**
 * RCP-74 — the link-capable toast.
 *
 * The refusal for a saved copy must read "This recipe is already live at
 * [here]" with "here" a REAL hyperlink to /r/<source-slug>. The pre-existing
 * View affordance is Recipe-object-driven and navigates in-app, so it cannot
 * carry a URL; these pin the linkUrl/linkLabel extension end to end — service
 * storage, component pass-through, and the template's anchor slot.
 */
import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ToastService } from '../../services/toast.service';
import { SaveToastComponent } from './save-toast.component';
import type { Recipe } from '../../recipe.types';

const createService = () =>
  runInInjectionContext(Injector.create({ providers: [] }), () => new ToastService());

describe('ToastService link support (RCP-74)', () => {
  it('stores linkUrl and linkLabel when a link is passed', () => {
    const service = createService();

    service.show('This recipe is already live at', null, 6000, {
      url: '/r/vegan-cornbread',
      label: 'here',
    });

    expect(service.toasts()[0]).toMatchObject({
      message: 'This recipe is already live at',
      recipe: null,
      linkUrl: '/r/vegan-cornbread',
      linkLabel: 'here',
    });
  });

  it('leaves the link fields unset for ordinary toasts', () => {
    const service = createService();

    service.show('Saved to your cookbook.');

    const t = service.toasts()[0];
    expect(t.linkUrl).toBeUndefined();
    expect(t.linkLabel).toBeUndefined();
  });
});

describe('SaveToastComponent link pass-through (RCP-74)', () => {
  const createComponent = () => {
    const service = createService();
    const injector = Injector.create({
      providers: [{ provide: ToastService, useValue: service }],
    });
    const component = runInInjectionContext(injector, () => new SaveToastComponent());
    return { component, service };
  };

  it('exposes linkUrl and linkLabel to the template', () => {
    const { component, service } = createComponent();

    service.show('This recipe is already live at', null, 6000, {
      url: '/r/vegan-cornbread',
      label: 'here',
    });

    expect(component.toast()).toMatchObject({
      linkUrl: '/r/vegan-cornbread',
      linkLabel: 'here',
    });
  });

  it('keeps the Recipe-driven View path intact when no link is set', () => {
    const { component, service } = createComponent();

    service.show('Saved to your cookbook.', { id: 'r1' } as Recipe);

    const t = component.toast();
    expect(t?.recipe).toMatchObject({ id: 'r1' });
    expect(t?.linkUrl).toBeUndefined();
  });
});

describe('save-toast template anchor (RCP-74)', () => {
  const html = readFileSync(
    fileURLToPath(new URL('./save-toast.component.html', import.meta.url)),
    'utf8'
  );

  it('renders a real anchor bound to linkUrl, labelled by linkLabel', () => {
    const anchor = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/);
    expect(anchor).not.toBeNull();
    expect(anchor![0]).toContain('[href]="t.linkUrl"');
    expect(anchor![0]).toContain('{{ t.linkLabel');
  });

  it('gives the link branch precedence over the in-app View button', () => {
    // One slot, link first: a toast carrying both must show the hyperlink.
    expect(html).toMatch(/@if \(t\.linkUrl\) \{[\s\S]*@else if \(t\.recipe\) \{/);
  });
});
