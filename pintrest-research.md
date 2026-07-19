> **Based on my research across Pinterest's official developer**
> **documentation, help center, and business resources, here's**
> **a comprehensive briefing on Pinterest SEO and links guidelines for developers:**
    
    
    
# Pinterest SEO & Links Guidelines for Developers
## Generated: 2026-07-18 | Routed: fallback (general research)


TL;DR
Pinterest's developer ecosystem centers on Rich Pins
(Article, Product, Recipe) powered by Open Graph/Schema.org
metadata, and the Pinterest API v5 for programmatic
access. Key SEO levers: semantic markup on your site,
proper Pin attribution/links back to source, and compliance
with Developer Guidelines (no scraping, no automation of
user actions, respect rate limits). Links from Pins pass
referral traffic but are nofollow — SEO value comes from
discovery, engagement, and Rich Pin metadata surfacing in Pinterest search.

[Button INfo](https://developers.pinterest.com/docs/web-features/buttons/#buttons)

1. What Are Pinterest SEO & Link Guidelines for
Developers?

Core Concept
Pinterest is a visual discovery engine, not a
traditional search engine. "SEO" here means optimizing for
Pinterest's internal search & recommendation systems
(which surface Pins to users) and Rich Pin metadata
that enhances Pin display/click-through.

Two Distinct Tracks
Track: Rich Pins / Web Features
What It Covers: On-page metadata (Open Graph, Schema.org)
that Pinterest scrapes when users save Pins from your site
Primary Audience: Site owners, content publishers,
e-commerce devs
────────────────────────────────────────
Track: Pinterest API v5
What It Covers: Programmatic access to create/manage Pins,
boards, ads, catalogs, analytics
Primary Audience: App developers, marketing platforms,
agencies



2. Rich Pins — The Primary SEO Lever for Developers

Three Types (Priority Order)
1. Product Rich Pins — Price, availability, product
title, description (highest priority)
2. Article Rich Pins — Headline, description, author,
publish date
3. Recipe Rich Pins — Title, servings, cook time,
ratings, ingredients, diet labels

Required Metadata Formats
Pinterest reads both Open Graph and Schema.org; if both
present, priority is:
1. Schema.org (most specific)
2. Open Graph
3. h-recipe / h-product microformats (legacy)

Article Rich Pin Example (Open Graph)
```html
<meta property="og:title" content="Title of your Article"/>
<meta property="og:description" content="Description of
your article" />
<meta property="og:type" content="article" />
```

Article Rich Pin Example (Schema.org)
```html
<meta property="og:site_name" content="Example Site" />
<div itemscope itemtype="https://schema.org/Article">
<meta itemprop="url"
content="https://www.example.com/2013/10/article.html" />
<span itemprop="name" content="Article Title" /> by <span
itemprop="author" content="John Doe" />
<span itemprop="description">A description or summary of
the article.</span>
</div>
```

Product Rich Pin (Open Graph)
```html
<meta property="og:title" content="De Young Copper Bookmark" />
<meta property="og:type" content="product" />
<meta property="product:price:amount" content="15.00" />
<meta property="product:price:currency" content="USD" />
```

Setup Flow
1. Add metadata tags to <head> of each page
2. Apply for Rich Pins via [Pinterest Developer
Portal](https://developers.pinterest.com/docs/rich-pins/overview/)
 (one-time domain verification)
3. Validate with [Rich Pin
Validator](https://developers.pinterest.com/tools/url-debugger/)
4. Wait up to 24 hrs for sync; existing Pins from your
domain auto-upgrade

Opt-Out (Per Page)
```html
<meta name="pinterest-rich-pin" content="false" />
```



3. Links Policy & Attribution Requirements

From Developer Guidelines (policy.pinterest.com/developers)
> If your app publishes content from Pinterest, you must:
> - Link Pins back to their source on Pinterest (e.g.
https://www.pinterest.com/pin/424605071126047814/)
> - Make it clear the content comes from Pinterest
> - Not cover or obscure content from Pinterest (no filters
on Pins)
> - Not create new content from Pins for distribution on
your app/service

Pin Link Structure
- Pin URL: https://www.pinterest.com/pin/<PIN_ID>/
- Board URL:
https://www.pinterest.com/<username>/<board-slug>/
- User Profile: https://www.pinterest.com/<username>/

Link Attributes
- All outbound links from Pinterest (Pin clicks, website
visits) carry rel="nofollow noreferrer"
- No direct PageRank flow — SEO value is indirect:
discovery → saves → clicks → site traffic → signals to Google

Save Button / Widget (Add-ons)
- Use official JS: `<script async defer
src="https://assets.pinterest.com/js/pinit.js"></script>`
- Place near </body>; async load recommended
- Generates nofollow links to Pinterest



4. Pinterest API v5 — Developer Access & Limits

Access Tiers
Tier: Trial
Use Case: Exploration
Rate Limits: Daily caps per app
Pin/Board Visibility: Sandbox only (visible only to creator)
────────────────────────────────────────
Tier: Standard
Use Case: Production apps
Rate Limits: Per-minute / per-user / per-app
Pin/Board Visibility: Public (full distribution)

Key Endpoints for Organic Content
Endpoint: POST /v5/pins
Scope: pins:create
Purpose: Create a Pin (with media, link, board)
────────────────────────────────────────
Endpoint: GET /v5/pins/<id>
Scope: pins:read
Purpose: Read Pin metadata
────────────────────────────────────────
Endpoint: PATCH /v5/pins/<id>
Scope: pins:update
Purpose: Update Pin (board, description, link)
────────────────────────────────────────
Endpoint: DELETE /v5/pins/<id>
Scope: pins:delete
Purpose: Delete Pin
────────────────────────────────────────
Endpoint: GET /v5/boards
Scope: boards:read
Purpose: List user's boards
────────────────────────────────────────
Endpoint: POST /v5/boards
Scope: boards:create
Purpose: Create board

Authentication
- OAuth 2.0 (Authorization Code flow with PKCE)
- Access tokens: 1 hour (refresh tokens available)
- App review required for Standard access (video demo of OAuth flow mandatory)

Rate Limits
- Trial: Daily caps by endpoint category
- Standard: Granular per-minute / per-user / per-app limits
- Check X-RateLimit-* headers; implement exponential
backoff

Prohibited API Uses (per Developer Guidelines)
- ❌ Scraping or automated data extraction
- ❌ Automating user actions (saves, follows, comments)
without explicit per-action user consent
- ❌ Storing API data (except campaign analytics for your
own account) — call API each time
- ❌ Competitive benchmarking / platform insights without
written authorization
- ❌ Circumventing geo-restrictions or rate limits
- ❌ Apps for children <13



5. Content Management Best Practices (SEO-Adjacent)

Pin Creation Guidelines
- Image aspect ratio: 2:3 (1000×1500px recommended);
max 1:2.1, min 1:1
- File types: JPEG, PNG, WebP; max 20MB
- Title: ≤100 chars (truncated in feed)
- Description: ≤500 chars; include keywords naturally;
first 50-60 chars show in feed
- Link: Must point to a **publicly accessible,
mobile-friendly landing page** (no interstitial, no login wall)
- Board selection: Relevant board improves distribution

Keyword / Discovery Optimization
- Pinterest search indexes: Pin title, description, board
name, board description, linked page title/meta
- Use Pinterest Trends (trends.pinterest.com) for
seasonal / rising queries
- Hashtags: 3-5 relevant tags in description (less critical
than keywords in text)

Catalogs / Shopping (Product Pins at Scale)
- Upload product feed via Catalogs API or Merchant Center
- Required fields: id, title, description, link,
image_link, price, availability, brand, google_product_category
- Enables Shopping Ads, Product Rich Pins,
dynamic retargeting



6. Key Actors & Ecosystem

Actor: Pinterest Engineering
Role: Platform APIs, Rich Pins infrastructure, algorithm
updates
────────────────────────────────────────
Actor: Developer Relations
Role: App review, documentation, partner support
────────────────────────────────────────
Actor: Pinterest Partners (certified)
Role: Approved marketing platforms (e.g., Hootsuite, Later,
Tailwind, Sprinklr, Salesforce)
────────────────────────────────────────
Actor: Merchants / Publishers
Role: Implement Rich Pins, Catalogs, Save buttons
────────────────────────────────────────
Actor: Creators / Influencers
Role: Organic content; affiliate links via
pinterest.com/pin/ redirect tracking



7. What's Next / Watchpoints (2024-2025+)

Trend: AI-powered search & recommendations
Signal: Pinterest Assistant, visual search, "More like this"
Dev Implication: Structured metadata (Schema.org) becomes
more critical for semantic understanding
────────────────────────────────────────
Trend: Shopping integration deepening
Signal: Catalogs API v5, Shopping Ads, Checkout on Pinterest
(select markets)
Dev Implication: Product feed freshness & completeness =
direct revenue impact
────────────────────────────────────────
Trend: Performance+ / Automation
Signal: AI-driven campaign optimization
Dev Implication: Less manual targeting; more reliance on
first-party data & conversion API
────────────────────────────────────────
Trend: Video Pins / Idea Pins
Signal: Growing share of impressions
Dev Implication: API support for video upload (multipart),
aspect ratios 9:16, 1:1, 4:5
────────────────────────────────────────
Trend: API v5 maturation
Signal: v3/v4 deprecated; v5 stable since 2023
Dev Implication: Migrate legacy integrations; new features
only on v5
────────────────────────────────────────
Trend: Measurement / Attribution
Signal: Conversions API (CAPI), enhanced match
Dev Implication: Implement server-side event tracking for
accurate ROAS



8. Quick-Start Checklist for Developers

✅: 1
Task: Add Open Graph + Schema.org markup to
Article/Product/Recipe pages
Reference: Rich Pins Overview
────────────────────────────────────────
✅: 2
Task: Validate with URL Debugger
Reference:
────────────────────────────────────────
✅: 3
Task: Apply for Rich Pins (one-time per domain)
Reference: Apply
────────────────────────────────────────
✅: 4
Task: Add Save Button / Follow Button to site
Reference: Add-ons
────────────────────────────────────────
✅: 5
Task: Create developer app → get Trial access
Reference: Connect App
────────────────────────────────────────
✅: 6
Task: Implement OAuth 2.0 + PKCE
Reference: Auth Guide
────────────────────────────────────────
✅: 7
Task: Build Pin creation flow (respect user consent per
action)
Reference: Content Management
────────────────────────────────────────
✅: 8
Task: Request Standard access (video demo required)
Reference: Access Tiers
────────────────────────────────────────
✅: 9
Task: Monitor rate limits & changelog
Reference: Changelog
────────────────────────────────────────
✅: 10
Task: Read & comply with Developer Guidelines
Reference: Mandatory for app approval



9. Sources (Primary / Authoritative)

#: 1
Source: Pinterest Developers — Rich Pins Overview
Tier: Primary
Notes: Official setup, metadata specs, priority order
────────────────────────────────────────
#: 2
Source: Pinterest Developers — Article Rich Pins
Tier: Primary
Notes: Open Graph + Schema.org examples
────────────────────────────────────────
#: 3
Source: Pinterest Developers — Product Rich Pins
Tier: Primary
Notes: OG + Schema.org markup, catalogs
────────────────────────────────────────
#: 4
Source: Pinterest Developers — Recipe Rich Pins
Tier: Primary
Notes: Schema.org + h-recipe
────────────────────────────────────────
#: 5
Source: Pinterest Developers — Developer Guidelines
Tier: Primary
Notes: Must-comply policies (links, automation, data
storage, scraping)
────────────────────────────────────────
#: 6
Source: Pinterest Developers — API v5 Overview
Tier: Primary
Notes: Endpoints, auth, rate limits, access tiers
────────────────────────────────────────
#: 7
Source: Pinterest Developers — Key Concepts: Access Tiers
Tier: Primary
Notes: Trial vs Standard, rate limits, sandbox behavior
────────────────────────────────────────
#: 8
Source: Pinterest Business Help — Create Rich Pins
Tier: Secondary
Notes: Merchant-facing guide, same technical specs
────────────────────────────────────────
#: 9
Source: Pinterest Business Help — Merchant Guidelines
Tier: Secondary
Notes: Product Pin eligibility, feed requirements
────────────────────────────────────────
#: 10
Source: Pinterest Business Blog — Best Practices
Tier: Secondary
Notes: Algorithm updates, seasonal trends, case studies



Audit Summary
- Queries sent: ~18 | Sources received: 10
primary/secondary | Sources cited: 10
- Routing: Fallback (no specialist signals matched
"pinterest seo")
- Sub-questions addressed: What (Rich Pins, API), Why
(discovery engine), How (metadata, OAuth, catalogs), Who
(partners, merchants, Pinterest eng), What's next (AI
search, shopping, video)



*Want a deeper dive on any section — e.g., Catalogs API
feed schema, OAuth implementation patterns, or Pinterest
Trends API access?*
