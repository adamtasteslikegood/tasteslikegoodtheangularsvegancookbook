# Agent readiness spec

What www.tasteslikegood.org serves to AI crawlers and agents, stated as
requirements that a command can check. Tracked under KAN-395.

## Where the requirements come from

1. **The AIReady connector's scan.** Adam named it as the signal to use
   (2026-10-12). It reads `/robots.txt`, `/llms.txt`, `/sitemap.xml` and the
   home page, and reports AI crawler access, llms.txt, sitemap, structured data
   and Content Signals. AR-1 to AR-5 are those five checks.
2. **The wider list** of what an agent needs beyond being allowed in: a
   readable page format, a described API, a tool endpoint, and a statement of
   what is AI-generated. AR-6 to AR-10.

The connector could not be run when this was written: every call returned a
protocol error from the server. So no AIReady score is recorded here yet, and
AR-1 to AR-5 are written from its documented checks, not from its output.
Record the score in the table at the end once it runs.

## Requirements

| ID    | Requirement                                                                                                                                                                                    | Served by                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| AR-1  | `robots.txt` names GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Google-Extended and CCBot, and allows them the public pages. | Angular build asset                 |
| AR-2  | `robots.txt` carries a `Content-Signal` line.                                                                                                                                                  | Angular build asset                 |
| AR-3  | `/llms.txt` returns 200 as text, opens with a `#` title, and links the browse index, the sitemap and the public JSON.                                                                          | Angular build asset                 |
| AR-4  | `/sitemap.xml` returns 200 and is listed in `robots.txt`.                                                                                                                                      | Flask                               |
| AR-5  | The home page has `WebApplication` and `Organization` JSON-LD; every recipe page has `Recipe` JSON-LD.                                                                                         | Angular build, Flask                |
| AR-6  | The home page response has a `Link` header pointing at `/llms.txt`.                                                                                                                            | Express                             |
| AR-7  | A request with `Accept: text/markdown` for `/`, `/browse`, a category hub or `/r/<slug>` gets `text/markdown`, with `Vary: Accept`. Browsers still get HTML.                                   | Express for `/`, Flask for the rest |
| AR-8  | `/api/public/openapi.json` describes the unauthenticated read endpoints, and `/.well-known/api-catalog` (RFC 9727 linkset) points at it.                                                       | Flask, Express                      |
| AR-9  | `/mcp` is a read-only MCP server (Streamable HTTP) over published recipes with two tools, `search_recipes` and `get_recipe`. No generation tool: generation spends Gemini quota.               | Flask, proxied by Express           |
| AR-10 | The home page and `llms.txt` say in plain text that recipes and photos are generated with Google Gemini.                                                                                       | Angular build asset                 |

## The check

```bash
scripts/seo/check_agent_readiness.sh                      # production
scripts/seo/check_agent_readiness.sh https://staging.tasteslikegood.xyz
```

One line per requirement, exit 1 if any fails. It reads a deployed site, so it
is not a pull-request gate; it is the "done" test for this spec and for a
release that claims to move it. Staging serves a deny-all `robots.txt`, so
AR-1 and AR-2 fail there by design.

## State on 2026-10-12 (production, v0.6.2)

| ID    | State | Notes                                                          |
| ----- | ----- | -------------------------------------------------------------- |
| AR-1  | fail  | in PR #3669                                                    |
| AR-2  | fail  | in PR #3669; `ai-train` left unstated                          |
| AR-3  | fail  | in PR #3669                                                    |
| AR-4  | pass  |                                                                |
| AR-5  | pass  |                                                                |
| AR-6  | fail  | in PR #3669                                                    |
| AR-7  | fail  | not started                                                    |
| AR-8  | fail  | not started                                                    |
| AR-9  | fail  | not started                                                    |
| AR-10 | fail  | home page already mentions Gemini; `llms.txt` half in PR #3669 |

## Open decisions

- **`ai-train`** in `Content-Signal`: yes, no, or left unstated as now.
- **AR-7 on Flask**: Adam's `md4a-fastapi` package does this negotiation as ASGI
  middleware. Flask is WSGI, so it needs either a WSGI entry point in `md4a` or
  a Flask hook that does the same conversion.
- **Rate limits for AI crawlers** (KAN-396): the page limiter exempts search
  crawlers and meters the AI crawlers AR-1 welcomes.
- **Discovery file for AR-9**: which well-known path advertises the MCP server.
  Confirm against the current MCP specification before choosing one.

## Scores

| Date       | Tool                                         | Score  | Notes                                                      |
| ---------- | -------------------------------------------- | ------ | ---------------------------------------------------------- |
| 2026-10-12 | third-party "AI Index" (tool not identified) | 34/100 | Openness 100, Visibility 35, Maturity 0, Agent Readiness 0 |
