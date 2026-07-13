# Page Relationships & Navigation Map

> **Generated:** 2026-07-10

## Navigation graph

```
                    ┌──────────────────────┐
                    │  Recipe Generator /  │◄──────── logo click, tab,
                    │  Recipe Detail ( / ) │          browser Back
                    └───────┬──────────────┘
        tab / empty-state   │  ▲ card click (view recipe)
        CTA / auto after    ▼  │
        ?save flow    ┌──────────────────┐
                      │ My Kitchen       │◄──── #kitchen hash deep-link
                      │ (/#kitchen)      │      (from SSR pages)
                      └──────────────────┘
                               ▲
        ?save=<slug> ──────────┘
             │
   ┌─────────┴────────────┐    "View public page" link ┌───────────────┐
   │ Public recipe page   │◄───(new tab, from detail)──│ slug field on │
   │ /r/<slug>  (SSR)     │                            │ detail view   │
   └─────────┬────────────┘                            └───────────────┘
             │ listed on
             ▼
   ┌──────────────────────┐        ┌──────────────────┐
   │ Browse index /browse │        │ /sitemap.xml     │──► search engines
   │ (SSR)                │        └──────────────────┘
   └──────────────────────┘
   ┌──────────────────────┐
   │ /privacy-policy      │◄── footer link (static HTML, Express-served)
   └──────────────────────┘
```

## SPA view switching (no router)

The Angular app has **no Angular Router** — it switches between two views via a signal (`activeView`), synchronized with browser history:

- Entering My Kitchen pushes `{view: 'kitchen'}` history state; opening a recipe from the kitchen pushes `{view: 'recipe-detail'}`; the browser Back button walks these states (popstate handler).
- The `#kitchen` hash is honored only as an initial-entry deep-link (SSR pages link to `/#kitchen`); it is cleared when returning to the Generator so it can't hijack later back/forward navigation.

## Cross-boundary flows (SSR ⇄ SPA)

| Flow | Parameters | Behavior |
|------|-----------|----------|
| SSR "Save to Cookbook" CTA → SPA | `/?save=<slug>` | The SPA strips the param (so refresh doesn't re-trigger), validates the slug against `^[a-z0-9-]+$` (after trim+lowercase; prevents client-side request forgery), waits for the startup auth check, ensures a session, fetches `GET /api/recipes/public/<slug>`, saves a **copy with a fresh ID** into the cookbook (reusing the source ID would 409-collide and never persist), then navigates to My Kitchen. |
| SPA publish → SSR | slug on the recipe | Public toggle + slug field on the detail view produce `/r/<slug>`; the link opens in a new tab. |
| OAuth round-trip | `/?auth=success` | Google redirects back with this param; the SPA confirms the session via `/api/auth/check` and strips the param. |

## Data coupling

- **Generator ⇄ Kitchen:** both views render from the same signals (`currentUser().savedRecipes` / `.cookbooks`); any save, delete, publish, or cookbook change is visible in both instantly, including the header's saved-recipe badge.
- **localStorage ⇄ API:** every mutation writes localStorage first, then syncs to Flask. A one-time-per-session hydration merges API data into local state after the auth check (guests included — guest data is scoped by a server-issued guest session cookie).
- **Login merge:** on Google sign-in, existing guest recipes/cookbooks are retained in the new authenticated session and pushed to the account through the normal save flow.
- **SSR pages read the same database:** publishing in the SPA makes the recipe appear at `/r/<slug>`, on `/browse`, and in `/sitemap.xml` (once public and, for guests, never — publishing is OAuth-gated).
