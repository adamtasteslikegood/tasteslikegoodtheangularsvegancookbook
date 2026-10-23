import type { SaveRefusal } from '../../services/persistence.service';
import { publishToggleKind } from '../../utils/public-link';
import { exportableRecipe } from '../../utils/recipe-row';
import type { Ingredient, IngredientGroup, InstructionStep, Recipe } from '../../recipe.types';

/** KAN-330: the server's own reason, so the toggle, the toast and the 400 agree. */
export const NOT_GENERATED_PUBLISH_REFUSAL =
  'Only recipes generated here can have a public page. Manually entered, imported or still-generating recipes can’t be published.';

/** Carries the server's refusal reason through the existing throw/catch in
 *  `togglePublic`, so the catch can explain what happened instead of assuming
 *  the network broke. */
export class PublishSyncError extends Error {
  constructor(readonly refusal: SaveRefusal) {
    super(`Publish state failed to sync to the server (${refusal})`);
    this.name = 'PublishSyncError';
  }
}

/**
 * The toast for a failed publish/unpublish (KAN-155).
 *
 * The old copy said "Check your connection and try again" for every failure.
 * That is right for a genuine sync failure and wrong for a deliberate refusal —
 * it blamed the user's network for a permission decision. But the reverse
 * over-correction is just as wrong: RCP-61's repro is a stale tab whose auth had
 * not resolved, where the row really is the user's own and retrying after
 * logging in really does work. Telling that user "this belongs to a different
 * account" would tell them to abandon their own recipe.
 *
 * So: one message per situation, and the network advice survives where it is
 * actually true.
 */
export function publishFailureMessage(refusal: SaveRefusal, publishing: boolean): string {
  // The ownership check fires on the same POST regardless of direction, so an
  // UNPUBLISH can be refused too. Hardcoding "published" told a user trying to
  // unpublish that their recipe "can't be published" — right reason, wrong verb.
  const verb = publishing ? 'published' : 'unpublished';

  switch (refusal) {
    case 'OWNERSHIP_OTHER_ACCOUNT':
      return `This recipe belongs to a different account, so it can’t be ${verb} from here.`;
    case 'OWNERSHIP_OTHER_GUEST_SESSION':
      // Deliberately verb-free: the remedy is the message, and it is the same in
      // both directions.
      return 'This recipe was saved in a different browser session. Log in and try again — if it’s yours, it’ll be there.';
    case 'OWNERSHIP_ORPHANED_GUEST_ROW':
      // Known-incomplete on KAN-155: the repair is not built, so do not promise
      // that retrying works. Say what is true and stop.
      return `This recipe was saved before you logged in and isn’t linked to your account yet, so it can’t be ${verb}.`;
    case 'duplicate':
      // KAN-241: structurally unreachable from togglePublic (you cannot publish a
      // saved copy — the 403 guard fires first), but the type system includes it.
      return 'You already have this recipe saved.';
    case 'ownership':
      // 409 without a recognised code — an older Backend, or one newer than this
      // build. Refused for certain, specific reason unknown; say only that much.
      return `This recipe can’t be ${verb} from this account or session.`;
    case 'paused':
      // KAN-330: Express is holding recipe writes for a few minutes. The
      // network is fine and a retry will work, so say that and nothing more.
      return `Recipes are read-only for a few minutes while we finish some maintenance, so this wasn’t ${verb}. Please try again shortly.`;
    case 'sync':
    default:
      return publishing
        ? 'Publishing failed to sync to the server. Check your connection and try again.'
        : 'Unpublishing failed to sync to the server. Check your connection and try again.';
  }
}

/**
 * KAN-330 / KAN-333: the notes are already on this device (the save writes
 * localStorage first), so a refused sync has to be said out loud or closing
 * the editor reads as "synced".
 */
export function notesSaveFailureMessage(refusal: SaveRefusal | undefined): string {
  if (refusal === 'paused') {
    return 'Your notes are saved on this device but not synced yet: recipes are read-only for a few minutes while we finish some maintenance. They’ll sync on your next save.';
  }
  if (refusal === 'duplicate') {
    // KAN-333: saving again cannot help; the account holds another copy.
    return 'Your notes are saved on this device only: your account already has this recipe as another copy, so they were not synced. Copy them before you reload: a reload shows that copy without them.';
  }
  return 'Your notes are saved on this device but not synced to your account yet. Check your connection and save again.';
}

/** KAN-289 (RCP-62): confirm the page really went offline. */
export function unpublishSuccessMessage(slug: string | null | undefined): string {
  return slug
    ? `Unpublished. /r/${slug} is offline until you publish it again.`
    : 'Unpublished. The public page is offline until you publish it again.';
}

/** Title / refusal copy for the publish switch based on sync state and recipe kind. */
export function publishToggleTitleFor(recipe: Recipe, pending: boolean): string {
  if (pending) return 'Checking publish state…';
  const kind = publishToggleKind(recipe);
  if (kind === 'locked') return 'Canonical recipe — publish state is locked';
  if (kind === 'manual') return NOT_GENERATED_PUBLISH_REFUSAL;
  if (kind === 'source') {
    return `Saved copies can't be published — the original recipe at /r/${recipe.sourceSlug} owns the public page.`;
  }
  return recipe.is_public ? 'Unpublish this recipe' : 'Publish this recipe';
}

export type PublishPreconditionResult =
  | { allowed: true }
  | {
      allowed: false;
      message: string;
      duration?: number;
      action?: { url: string; label: string };
    };

/**
 * Validates whether a recipe can transition to `is_public = true` before
 * mutating state or sending a network request.
 */
export function checkPublishPreconditions(
  recipe: Recipe,
  slugFromTitleFn: (name: string) => string
): PublishPreconditionResult {
  const kind = publishToggleKind(recipe);

  // RCP-74: saved copies cannot be published — the source page owns
  // publication. Templates mark the toggle disabled for this kind, but this
  // base is shared across surfaces and a template can forget (the generator
  // shipped ungated): this guard is the refusal, not a courtesy. The server
  // rejects the change with 403 once the Backend guard lands (Backend #279).
  if (kind === 'source') {
    // D1 copy: "This recipe is already live at [here]" — a different message
    // class from the refusal below. It redirects rather than scolds:
    // "here" is a real hyperlink to the source's public page (RCP-76 AC3).
    return {
      allowed: false,
      message: 'This recipe is already live at',
      duration: 6000,
      action: { url: `/r/${recipe.sourceSlug}`, label: 'here' },
    };
  }

  // KAN-330 (widening KAN-140): only a recipe the server generated can go
  // public — the server rejects everything else with 400; the template
  // disables the toggle, this backstops it with the same reason.
  if (kind === 'manual') {
    return {
      allowed: false,
      message: NOT_GENERATED_PUBLISH_REFUSAL,
    };
  }

  // KAN-104 (#3146): a title with no ASCII alphanumerics (all-emoji,
  // pure-CJK/Cyrillic) derives an empty slug, which the server rejects
  // with 400. Same derivation as the server (parity is spec-pinned), so
  // catch it before the round trip and say why instead of failing silently.
  if (!recipe.slug && !slugFromTitleFn(recipe.name)) {
    return {
      allowed: false,
      message:
        "This recipe can't be published: its title has no letters or numbers (a-z, 0-9) to build a public link from.",
    };
  }

  return { allowed: true };
}

/**
 * GH #3256 (KAN-144): manual entry used to write the user's own "Chef's
 * Notes" into `notes` — the field KAN-140 froze as generated, publicly
 * rendered, read-only content. Those recipes were left with notes they
 * could no longer edit and a pencil that opened an empty box.
 *
 * A manual recipe can never be published, so nothing public depends on its
 * `notes`: on first edit, adopt the text into personalNotes instead.
 */
export function migratesLegacyNotes(r: Recipe): boolean {
  return r.origin === 'manual' && !r.personalNotes && !!r.notes;
}

/** Initial text for the personal-notes editor, migrating legacy manual notes if needed. */
export function initialPersonalNotesEditorValue(r: Recipe): string {
  return migratesLegacyNotes(r) ? (r.notes ?? '') : r.personalNotes || '';
}

/** Produces an immutable Recipe copy with updated personalNotes (and cleared legacy manual notes). */
export function applyPersonalNotesEdit(r: Recipe, editedNotes: string): Recipe {
  const updatedRecipe: Recipe = { ...r, personalNotes: editedNotes };
  if (migratesLegacyNotes(r)) updatedRecipe.notes = '';
  return updatedRecipe;
}

/** Scales wet/dry/other ingredient groups by the given servings multiplier. */
export function scaleRecipeIngredients(r: Recipe | null, mult: number): IngredientGroup | null {
  if (!r) return null;

  const scaleIngredient = (ing: Ingredient): Ingredient => {
    let newAmount: number | number[];
    if (Array.isArray(ing.amount)) {
      newAmount = ing.amount.map((val) => Number((val * mult).toFixed(2)));
    } else {
      newAmount = Number((ing.amount * mult).toFixed(2));
    }
    return { ...ing, amount: newAmount };
  };

  const scaledGroup: IngredientGroup = {};
  if (r.ingredients.wet) scaledGroup.wet = r.ingredients.wet.map(scaleIngredient);
  if (r.ingredients.dry) scaledGroup.dry = r.ingredients.dry.map(scaleIngredient);
  if (r.ingredients.other) scaledGroup.other = r.ingredients.other.map(scaleIngredient);
  return scaledGroup;
}

/** Formats numeric ingredient amounts, converting common decimals to fractions. */
export function formatIngredientAmount(amount: number | number[]): string {
  if (Array.isArray(amount)) {
    return amount.join(' - ');
  }
  const decimal = amount;
  if (Math.abs(decimal - 0.25) < 0.01) return '1/4';
  if (Math.abs(decimal - 0.5) < 0.01) return '1/2';
  if (Math.abs(decimal - 0.75) < 0.01) return '3/4';
  if (Math.abs(decimal - 0.33) < 0.01) return '1/3';
  if (Math.abs(decimal - 0.66) < 0.01) return '2/3';
  return decimal.toString();
}

/** Extracts display text from a string or structured InstructionStep. */
export function formatInstructionText(step: string | InstructionStep): string {
  return typeof step === 'string' ? step : step.description;
}

/** Downloads a single recipe as a clean JSON file via an ephemeral object URL. */
export function downloadRecipeJson(recipe: Recipe): void {
  const fileName = `${recipe.name.replace(/\s+/g, '_')}.json`;
  const blob = new Blob([JSON.stringify(exportableRecipe(recipe), null, 2)], {
    type: 'application/json',
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  window.URL.revokeObjectURL(url);
}
