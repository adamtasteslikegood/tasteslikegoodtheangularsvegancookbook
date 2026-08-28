# Appendix: Enum and State Dictionary

**Target:** v0.4.12

These values drive user-visible behavior. Some are TypeScript or Python string unions rather than database enum types.

## 1. Authentication provider

| Value    | Meaning                                | UI effect                                                       |
| -------- | -------------------------------------- | --------------------------------------------------------------- |
| `guest`  | Browser visitor without Google session | Guest identity, session-scoped kitchen, Sign In, no publication |
| `google` | Google-authenticated user              | Profile, cross-device persistence, eligible publication         |

## 2. Recipe origin

| Value          | Meaning                      | Publication                                                                  |
| -------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| `generated`    | Created by AI generation     | Eligible when owned, signed in, non-canonical, and without source provenance |
| `manual`       | Entered through Write Recipe | Cannot be newly published                                                    |
| `saved`        | Copied from a public recipe  | Cannot publish; source page owns publication                                 |
| null or absent | Legacy or unknown            | Eligible unless another lock or provenance rule applies                      |

Origin is settable only while absent and immutable afterward. Server state, not request shape alone, determines effective provenance.

## 3. Recipe processing status

| Value              | Meaning                                                | Terminal     | Expected UI                                                     |
| ------------------ | ------------------------------------------------------ | ------------ | --------------------------------------------------------------- |
| `generating`       | Recipe request queued or claimed                       | No           | Recipe progress                                                 |
| `processing`       | Model output being normalized, validated, or persisted | No           | Continue recipe polling                                         |
| `ready`            | Recipe content is usable                               | Yes for text | Render; image may exist, be pending by metadata, or have failed |
| `generating_image` | Image request queued or claimed                        | No           | Shared service-owned image progress                             |
| `error`            | Recipe-text generation failed terminally               | Yes          | Stop recipe polling and show safe failure guidance              |

Terminal image failure returns the recipe to `ready` and records failure in image metadata, preserving usable cooking content. Clients combine top-level status with image metadata.

## 4. Image request metadata state

| State concept          | Meaning                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `pending`              | Image work requested and awaiting or eligible for worker handling                |
| claimed or in progress | Worker owns current lease or request token                                       |
| `complete`             | Current request is no longer pending, either success or terminal handled failure |
| retry response         | Failure is retryable by Pub/Sub; request metadata remains suitable for retry     |
| superseded concept     | An older claim cannot overwrite newer regeneration                               |

Exact internal metadata is not a public enum. The product invariant is one current request wins, delivery is idempotent, and the client reaches a terminal experience.

## 5. Publish toggle kind

| Value    | Precedence or condition                              | UI behavior                                           |
| -------- | ---------------------------------------------------- | ----------------------------------------------------- |
| `locked` | `is_canonical=true`                                  | Grey focusable explanation; no mutation               |
| `manual` | Private `origin=manual`                              | Grey explanation; no publication                      |
| `source` | Meaningful source provenance different from own slug | Grey explanation; View opens source                   |
| `normal` | None of the above                                    | Eligible subject to auth, ownership, and initial sync |

Canonical lock wins. A legacy/manual row already public may remain manageable by compatibility rules, but a private manual row cannot be newly published.

## 6. Public link kind

| Value    | Meaning                                    | Destination and presentation                         |
| -------- | ------------------------------------------ | ---------------------------------------------------- |
| `own`    | Recipe is public with own slug             | `/r/<slug>`, ordinary View style                     |
| `source` | Unpublished copy has different source slug | `/r/<sourceSlug>`, muted or italic source indication |
| null     | No own or source address                   | No View link                                         |

Own public slug wins when both exist. A `sourceSlug` equal to the row's own slug is not an external source after unpublishing.

## 7. Save result and error code

| Code                            | HTTP  | Meaning                                      | Required treatment                         |
| ------------------------------- | ----- | -------------------------------------------- | ------------------------------------------ |
| `RECIPE_ALREADY_SAVED`          | `409` | Same public source identity already exists   | Benign message; retain one recipe          |
| `OWNERSHIP_OTHER_ACCOUNT`       | `409` | Different account owns row                   | Final refusal; no local duplicate          |
| `OWNERSHIP_OTHER_GUEST_SESSION` | `409` | Different guest session owns row             | Sign-in or recovery guidance; no overwrite |
| `OWNERSHIP_ORPHANED_GUEST_ROW`  | `409` | Signed-in caller reached unclaimed guest row | Explain mismatch; no silent claim          |

Stable prose is fallback, but clients use the machine code where present.

## 8. Publication refusal class

| Class or message contract   | Meaning                                                       |
| --------------------------- | ------------------------------------------------------------- |
| Public slug required        | No submitted or derived value yields a usable normalized slug |
| Canonical recipe locked     | Publication, slug, or deletion is locked by canonical status  |
| Manual recipe unpublishable | Manual origin cannot be newly public                          |
| Cannot publish a saved copy | Persisted source provenance owns the public page              |
| Recipe ownership error      | Caller scope does not own the row                             |

Every refusal keeps or restores prior persisted publication state.

## 9. Ingredient group

| Value                 | Meaning                                                    |
| --------------------- | ---------------------------------------------------------- |
| `wet`                 | Wet or liquid group; schema-required array                 |
| `dry`                 | Dry group; schema-required array                           |
| `other`               | Optional miscellaneous group                               |
| Additional string key | Schema-compatible custom group rendered as another section |

Manual entry offers wet, dry, and other and defaults rows to dry.

## 10. Ingredient scale

| Value | Meaning            |
| ----- | ------------------ |
| `0.5` | Half recipe        |
| `1`   | Stored base recipe |
| `2`   | Double recipe      |

Scale is transient presentation state.

## 11. Instruction shape

| Shape  | Example                                              | Rendering                                        |
| ------ | ---------------------------------------------------- | ------------------------------------------------ |
| String | `"Bake until golden."`                               | Array position supplies order                    |
| Object | `{ "step": 2, "description": "Bake until golden." }` | Description renders; explicit step is normalized |

## 12. Route classification

| Value        | Meaning                                      | Express behavior                            |
| ------------ | -------------------------------------------- | ------------------------------------------- |
| `api`        | `/api` or `/api/*`                           | Proxy to Flask                              |
| `ssr`        | `/browse`, `/sitemap.xml`, `/r/*`            | Proxy Flask-rendered response               |
| `ssrStatic`  | `/static/*`                                  | Proxy Flask static asset                    |
| `standalone` | `/privacy-policy`, `/favicon.ico`            | Express static response                     |
| `asset`      | Known extension reaching catch-all           | Return `404`                                |
| `spa`        | `/`, `/kitchen`, `/chunk-error`, `/recipe/*` | Serve Angular shell                         |
| `unknown`    | Other non-asset path                         | Serve shell; Angular wildcard redirects `/` |

## 13. Environment and indexing mode

| Mode               | Canonical behavior                                                    |
| ------------------ | --------------------------------------------------------------------- |
| Production         | Canonical `www.tasteslikegood.org`; HTML index/follow; public sitemap |
| Staging or preview | Separate origin/project; noindex/nofollow; robots disallow all        |
| Local              | Dev proxy and memory/SQLite fallbacks; no production indexing promise |

## 14. Rate-limit class

| Class     | Default                   | Purpose                                   |
| --------- | ------------------------- | ----------------------------------------- |
| API       | 300 per 15 minutes per IP | Ordinary JSON calls                       |
| Page      | 300 per 15 minutes per IP | HTML navigation; separate from API budget |
| Expensive | 20 per hour per IP        | Recipe and image generation               |

## 15. Authentication modal environment

| State            | Meaning                                | Action                                            |
| ---------------- | -------------------------------------- | ------------------------------------------------- |
| Standard browser | Google OAuth supported                 | Show Sign in with Google                          |
| Embedded browser | Known webview likely blocked by Google | Explain; Copy Page Link and open Safari or Chrome |
| Loading          | Login URL or session operation pending | Prevent repeat activation and show progress       |
| Error            | Login initiation or callback failed    | Recoverable message; preserve guest kitchen       |

## 16. Interaction state concepts

| Domain              | Values or concepts                                      |
| ------------------- | ------------------------------------------------------- |
| Recipe save         | unsaved, saving, saved, duplicate, refused, failed      |
| Image               | absent, pending, available, failed, timed out           |
| Cookbook membership | not member, member, pending add or remove, failed       |
| Notes               | read, editing, saving, failed                           |
| SSR kitchen modal   | closed, open and focus-trapped                          |
| Recycle bin         | active, locally deleted, restoring, permanently removed |

Components may represent these with signals and booleans rather than named enum declarations; the user-visible transitions remain required.
