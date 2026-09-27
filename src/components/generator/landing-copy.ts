/**
 * Home-page landing copy (KAN-272).
 *
 * "vegan recipe generator" is the query family the home page exists to rank
 * for, and until KAN-272 the page had no H1 and 42 words of server HTML —
 * nothing for Google to rank. The copy is rendered twice:
 *
 *   1. by GeneratorComponent, from these constants — the rendered DOM Google
 *      indexes after running the JavaScript;
 *   2. as static HTML inside <app-root> in the root index.html — what non-JS
 *      crawlers, link unfurlers and the first paint see before the ~800 KB
 *      bundle boots. Angular replaces it on bootstrap.
 *
 * The FAQPage JSON-LD in index.html repeats the questions and answers.
 * `src/landing-copy.test.ts` fails if either copy drifts from this file, so
 * edit here first and mirror the change into index.html.
 *
 * Keep claims checkable against the product: generation is prompted as vegan
 * (Backend `generation_bp`) but is AI output, hence the label advice.
 */

export const LANDING_H1 = 'Vegan Recipe Generator';

export const LANDING_LEAD =
  "Type what you're craving and get a complete vegan recipe, with an AI food photo, in seconds. No ads, no life story, no paywall.";

export const LANDING_INTRO: readonly string[] = [
  'VeganGenius Chef is a free AI vegan recipe generator from TastesLikeGood. Describe a dish, a mood or the ingredients already in your fridge, like "spicy lentil tacos", "something with chickpeas and spinach" or "a vegan mac and cheese", and it writes a full plant-based recipe: measured ingredients, step-by-step method, prep and cook times, and servings.',
  'Save the recipes you like to your own cookbook, sort them into collections, and publish your favourites for everyone to browse.',
];

export interface LandingStep {
  readonly title: string;
  readonly text: string;
}

export const LANDING_STEPS: readonly LandingStep[] = [
  {
    title: 'Describe it',
    text: 'Type a dish, a craving, or a list of ingredients you want to use up.',
  },
  {
    title: 'Get the recipe',
    text: 'Google Gemini writes a complete vegan recipe, and a photo of the finished dish follows.',
  },
  {
    title: 'Save and cook',
    text: 'Keep it in your cookbook, scale the servings, and cook straight from the page.',
  },
];

export interface LandingFaq {
  readonly question: string;
  readonly answer: string;
}

export const LANDING_FAQ: readonly LandingFaq[] = [
  {
    question: 'Is the vegan recipe generator free?',
    answer:
      'Yes. Generating, saving and browsing recipes is free, with no ads and no subscription. A fair-use hourly limit keeps it free for everyone.',
  },
  {
    question: 'Are the recipes 100% vegan?',
    answer:
      'Every recipe is written to be vegan: no meat, fish, dairy or eggs. They are AI-generated, so check the labels on packaged ingredients, especially for allergens.',
  },
  {
    question: 'Can it make a recipe from the ingredients I already have?',
    answer:
      'Yes. List what is in your fridge or pantry, for example "tofu, broccoli, peanut butter", and it builds a recipe around those ingredients.',
  },
  {
    question: 'Do I need an account?',
    answer:
      'No. Continue as a guest and your cookbook is saved in this browser. Sign in with Google to keep it in sync across your devices.',
  },
  {
    question: 'Where do the food photos come from?',
    answer:
      'After the recipe is written, an AI image model creates a photo of the finished dish for that recipe. You can regenerate it if you want a different look.',
  },
];
