export interface Ingredient {
  name: string;
  amount: number | number[];
  units: string;
  notes?: string;
}

export interface IngredientGroup {
  wet?: Ingredient[];
  dry?: Ingredient[];
  other?: Ingredient[];
  [key: string]: Ingredient[] | undefined;
}

export interface InstructionStep {
  step: number;
  description: string;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  prepTime: number;
  cookTime: number;
  servings: number;
  ingredients: IngredientGroup;
  instructions: (string | InstructionStep)[];
  notes?: string;
  /**
   * KAN-140 — the user's private notes. The only notes field the SPA editor
   * writes; never rendered publicly (the Backend public payload/template
   * allowlist exposes `notes` only). `notes` above is generated content and
   * is read-only in the UI.
   */
  personalNotes?: string;
  tags?: string[];
  image_keywords?: string[];
  stock_image_url?: string;
  ai_image_url?: string;
  user_id?: string;
  image?: string;
  is_public?: boolean;
  slug?: string;
  /**
   * KAN-288/289 — server-owned: when the row first went public (ISO string),
   * null if it never has. Survives unpublish. A non-null value means deleting
   * the row permanently retires its /r/<slug> (410, never reused), so the
   * kitchen shows the irreversible type-the-slug confirmation. Undefined means
   * the Backend predates the column; see `hasEverBeenPublished`.
   */
  first_published_at?: string | null;
  /**
   * KAN-291 — server-owned, from `GET /api/recipes` only: the row owns a
   * `retired_slug` marker, so deleting it makes that slug permanent even when
   * `first_published_at` is null (the KAN-288 migration's owner markers on
   * private slugs). Undefined means the Backend predates the flag.
   */
  slug_reserved?: boolean;
  /**
   * The public `/r/<slug>` this recipe was saved from, if it originated from
   * the public site's "Save to cookbook" CTA. Used to dedup repeat saves so
   * tapping Save again surfaces the existing copy instead of adding another.
   */
  sourceSlug?: string;
  /**
   * KAN-265 — stable server-owned identity of the public source recipe.
   * Unlike sourceSlug, this survives source slug renames and lets hydration
   * mirror the Backend's guest→login deduplication decision.
   */
  sourceRecipeId?: string;
  /**
   * KAN-139 — server-owned lock for the canonical recipes curated in
   * specs/canonical-recipes.json. Read-only in the SPA: the API strips it on
   * create and pins it on update, and rejects unpublish/re-slug/delete of a
   * locked recipe with 400. The UI disables those controls up front.
   */
  is_canonical?: boolean;
  /**
   * KAN-140 — how the recipe entered the system. Manually entered recipes
   * cannot be published (server rejects with 400; the toggle is disabled).
   * Server-side the column is settable while NULL and immutable once set.
   */
  origin?: 'manual' | 'generated' | 'saved';
}
