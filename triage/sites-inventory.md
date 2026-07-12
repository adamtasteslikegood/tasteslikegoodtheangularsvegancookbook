# Atlassian Sites Inventory — Phase 0.1 (read-only)

Captured: 2026-07-11 by Claude (triage worktree session). Sources: Atlassian MCP
(main site) + read-only REST v3/v2 with `.env` API token (-dev site, which is
outside the MCP OAuth grant).

## Site 1 — tasteslikegood.atlassian.net (main / software + delivery)

- Cloud ID: `029decc8-e09a-4d55-92f8-20d9ca64ca13`

### Jira projects (6)

| Key  | Name                            | Type         | Managed          | In plan scope? |
| ---- | ------------------------------- | ------------ | ---------------- | -------------- |
| RCP  | Tasteslikegood Recipes Delivery | software     | company (classic)| yes — recipe delivery |
| KAN  | Tasteslikegood-dot-Org          | software     | team (next-gen)  | yes — recipe tasks |
| PLZG | 10110 Plaza Delivery            | software     | company (classic)| yes — plaza delivery |
| TO   | 10110 Tasteslikegood Plaza      | business     | team (next-gen)  | yes — plaza business |
| DR   | Development requests            | service_desk | company (classic)| **NOT in PLAN.md context** — discovered during inventory |
| TT   | Tastelikegood-team              | service_desk | company (classic)| **NOT in PLAN.md context** — discovered during inventory |

### Confluence spaces (8)

| Key    | Name                        | Type          | Space ID |
| ------ | --------------------------- | ------------- | -------- |
| TWC    | Teamwork Collection         | global        | 360451   |
| team57d5e9d65f0b468c9d9950ab0f55b30d | the aa2 team | global | 720898 |
| SD     | Software Development        | onboarding    | 7634944  |
| TLG    | Tasteslikegood.org          | global        | 11042818 |
| PLZA   | 10110 Tasteslikegood Plaza  | global        | 11075586 |
| ARTZEN | artazzendotcom              | collaboration | 13631492 |
| ~712020b8ee911e... | Adam Schoen (personal)  | personal | 7766016  |
| ~712020a1ad64fe... | Allison Lunn (personal) | personal | 6258691  |

## Site 2 — tasteslikegood-dev.atlassian.net (intended: public-facing service site)

- Cloud ID: `79a2fb43-0e7d-4140-9d46-2019ca09f314`
- NOT in the MCP OAuth grant (both pm-skills plugin and claude.ai Rovo
  connector refuse it). All -dev access in this triage is via REST API token.

### Jira projects (3)

| Key  | Name                  | Type         | Managed         | In plan scope? |
| ---- | --------------------- | ------------ | --------------- | -------------- |
| TO   | Tasteslikegood.org    | business     | team (next-gen) | yes — the duplicate-key TO to freeze |
| DEMO | Demo service space    | service_desk | company (classic)| not in plan; service-site scaffold |
| JIA  | Jira Integrations App | service_desk | company (classic)| not in plan; service-site scaffold |

### Confluence spaces (2)

| Key | Name                   | Type       | Space ID |
| --- | ---------------------- | ---------- | -------- |
| SD  | Software Development   | onboarding | 294916   |
| ~712020b8ee911e... | Adam Schoen (personal) | personal | 262146 |

## Notes / deviations from PLAN.md context

1. PLAN.md's context lists 4 main-site projects; the site has 6. `DR` and `TT`
   (service desks) were not in the plan. They need a scope decision (include in
   classification or explicitly out of scope) — parked under Blocked.
2. -dev TO is named "Tasteslikegood.org" (matches the plan's description).
   -dev also hosts DEMO/JIA service desks consistent with the "service site"
   intent.
3. MCP cannot write to -dev at all (not granted), so the Phase 2.3 freeze/rename
   of dev-TO will have to go through REST with the API token.
