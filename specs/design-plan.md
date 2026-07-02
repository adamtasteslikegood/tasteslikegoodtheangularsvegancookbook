# Design Implementation Plan: v0.2 Anti-Recipe Site

This document bridges the gap between the Claude Design prototype (`tasteslikegood-org-design0_2_0-files/project/Anti-Recipe Site.html`) and the technical execution plan for our Flask SSR Jinja templates.

## 1. Design System Integration

The `colors_and_type.css` provides a robust, semantic token system that we must integrate directly into our SSR templates.

**CSS Strategy:**

- **Base Token File:** Place the contents of `colors_and_type.css` in `Backend/static/css/tokens.css`.
- **Template CSS:** Instead of the inline `<style>` block found in the React prototype, move all the prototype's structural CSS (e.g., `.ar-border`, `.save-cta`, grid definitions) into `Backend/static/css/recipe-site.css`.
- **Fonts:** Include the Google Fonts link for `Playfair Display` and `Lato` in the `base.html` `<head>`.

## 2. Template Architecture

We will break the monolithic React prototype into three reusable Jinja templates.

### A. `base.html` (The Shell)

- **Header (`SiteHeader`):** The fixed `ar-border-b` header with the logo, "Browse" link, and "My Kitchen" SPA redirect.
- **Footer:** Simple copyright and links.
- **SPA Modal:** The `<div id="spa-modal">` for the "Your Kitchen Awaits" dialog. Render this hidden by default and toggle visibility via minimal vanilla JS.
- **Toast Notifications:** The `.toast` container for "Saved to Cookbook" feedback.

### B. `browse.html` (The Grid View)

- **Header Area:** Page title "Browse Recipes" with the total count.
- **Grid:** The responsive CSS Grid. The prototype allows 2, 3, or 4 columns. We will default to a responsive 3-column layout on desktop, collapsing to 1 column on mobile.
- **Cards:** Each recipe card displays the AI image, Title, Prep/Cook time, and tags. Clicking a card routes to `/r/<slug>`.
- **Pagination:** The styled "Prev / Next" controls mapped to Jinja URL variables (e.g., `?page=2`).

### C. `recipe.html` (The Detail View)

- **Hero Section:** The prototype provides "overlay" or "below" image options. We will implement the **"overlay"** design as the default, applying the `linear-gradient` to ensure text legibility.
- **Meta Bar:** Contains Prep Time, Cook Time, Servings, and the primary "Save to Your Cookbook" CTA.
- **Description:** The italicized `Playfair Display` intro paragraph.
- **Ingredients & Method (Two-Column Layout):**
  - Left Column: Ingredients categorized by type (Wet, Dry, Other) using the `.mono` font.
  - Right Column: Numbered, `border-bottom` steps.
- **Chef's Notes:** The SVG icon block with the `.mono` text area.
- **Footer Actions:** Tags listing and the "Save to Pinterest" `<a href>` button.

## 3. JavaScript & Interactions (Vanilla JS)

The React prototype uses state hooks for interactions. We must rewrite these using vanilla JavaScript in the SSR templates to maintain the "zero-fluff" <500ms speed goal.

- **"Save to Cookbook" CTA:**
  - Bind a click listener to `.save-cta`.
  - On click, show the "Saving..." state and spin the icon.
  - Set the `recipe_data` into `localStorage` (guest session flow).
  - Show the `.toast` animation for 3 seconds.
  - Change button state to `.saved`.
- **"My Kitchen" Navigation:**
  - Clicking the top-right button should remove `display: none` from the SPA Modal overlay.
  - Clicking "Continue as Guest" or "Continue with Google" redirects the browser to the Angular SPA URL (`/`).

## 4. Mobile Responsiveness

The prototype relies on hardcoded dimensions in some places. We must add the following media queries to `recipe-site.css`:

- `@media (max-width: 768px)`
  - Header padding reduces from `4rem` to `1rem`.
  - Browse Grid becomes `grid-template-columns: 1fr`.
  - Recipe Detail two-column layout (Ingredients/Method) becomes `flex-direction: column`.
  - "Save to Cookbook" CTA becomes `width: 100%`.

## 5. Next Steps for Implementation

1. Copy `colors_and_type.css` to the Flask static directory.
2. Create `base.html`, `browse.html`, and `recipe.html` in `Backend/templates/`.
3. Extract the React JSX from `Anti-Recipe Site.html` into Jinja markup, replacing JavaScript map/array functions with `{% for item in items %}` loops.
4. Implement the vanilla JS interaction script.
