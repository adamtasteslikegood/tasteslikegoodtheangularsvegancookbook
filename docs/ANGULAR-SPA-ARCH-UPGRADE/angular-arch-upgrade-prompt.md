# Angular SPA Architecture Upgrade — Review & PRD Planning Prompt

## Context

You are reviewing **Vegangenius Chef**, a vegan recipe generator and personal cookbook app. The system has three tiers: an Angular 22 SPA, an Express reverse proxy, and a Flask API backend. The Flask backend has already been through a rigorous refactoring — from a 1,200-line monolithic `app.py` to a ~100-line composition root with modular blueprints, service/repository layers, validators, and proper separation of concerns. It is production-grade, deployed on Cloud Run, and hardened.

The Angular SPA has not undergone the same transformation. It remains in the state it was originally generated as a Gemini AI Studio prototype. The frontend needs to be "graduated" to match the architectural quality of the backend.

## Current SPA State (Verified)

| Dimension | Current State |
|---|---|
| Components | **1** — the entire app is a single `AppComponent` (1,096 lines TS, 2,028 lines HTML) |
| Services | 3 (`GeminiService`, `AuthService`, `PersistenceService`) + 1 mapper utility |
| Routing | **None** — no `@angular/router`; view switching via a `signal<'generator' \| 'kitchen'>` and manual `pushState`/`popstate` |
| State management | Angular Signals on `AppComponent` + `AuthService`; ~30 independent UI-state signals, minimal `computed()` derivations |
| HTTP layer | Raw `fetch()` — no `HttpClient`, no interceptors, no centralized error handling |
| Forms | Template-driven (`FormsModule`, `[(ngModel)]`); no validation beyond name-not-empty |
| Code splitting | None — single bundle, no lazy loading |
| Polling | Unbounded `setInterval(2000)` with no timeout cap |
| Config | Hardcoded values; environment files contain only `production` and `flaskApiUrl` (both empty strings) |
| Tests | Service/utility tests exist; component testing blocked by monolith size |
| Express proxy | **Already production-grade** — separated concerns, graceful shutdown, validation, distributed rate limiting, proper error handling |

## What the Backend Got Right (The Quality Bar)

The Flask backend refactoring established patterns the frontend should match in spirit:

- **Composition root** — `app.py:create_app()` registers blueprints and extensions; no business logic in the entry point
- **Modular blueprints** — each domain (auth, recipes, collections, generation, worker) has its own blueprint with focused routes
- **Service layer** — business logic in `services/` (Gemini, image, stock images), decoupled from HTTP handling
- **Repository layer** — data access with file locking and DB abstraction
- **Validators** — JSON Schema Draft 7 validation at system boundaries
- **Configuration** — env-driven config with fail-fast on missing production secrets

## Task

Produce two deliverables:

### 1. Codebase Review

Assess the Angular SPA against production readiness. For each area, state the current condition, the gap, and the severity (critical / significant / minor):

- **Component architecture** — decomposition, single responsibility, reusability
- **Routing and navigation** — URL-driven state, deep linking, route guards, lazy loading
- **State management** — signal architecture, derived state, cross-component communication
- **HTTP and API layer** — client abstraction, interceptors, error handling, retry/timeout
- **Forms and validation** — reactive forms, field-level validation, user feedback
- **Performance** — bundle size, code splitting, change detection strategy
- **Testability** — component isolation, service mocking, coverage gaps
- **Configuration and environment** — externalized config, feature flags
- **Accessibility and UX patterns** — keyboard nav, screen readers, loading states, error states

### 2. PRD: Angular Architecture Upgrade

Structure the PRD as follows:

**Objective:** Graduate the Angular SPA from a single-component prototype to a production-grade Angular 22 application with proper decomposition, routing, state management, and operational readiness — matching the quality standard already established by the Flask backend.

**Scope boundaries:**
- IN: Architectural refactoring, component decomposition, routing, state management, HTTP layer, forms, testing infrastructure
- OUT: New features, backend API changes, Express proxy changes, UI redesign (visual design stays the same)
- CONSTRAINT: The Express proxy layer is already production-grade and should not be modified. The Flask API surface is stable — the frontend adapts to it, not the reverse.

**Phased approach:** Break the upgrade into sequenced phases where each phase produces a deployable, non-regressing state. No big-bang rewrite. Each phase should identify:
- What changes
- What the acceptance criteria are
- What risks exist and how they are mitigated
- Dependencies on prior phases

**Key architectural decisions to address:**
- Component decomposition strategy (feature modules vs. standalone component tree)
- Routing architecture (flat vs. nested, lazy loading boundaries)
- State management pattern (pure Signals vs. signal store vs. lightweight library)
- HTTP client strategy (Angular HttpClient + interceptors vs. current fetch)
- Form strategy (reactive forms, validation schema)
- Testing strategy (component harness, service testing, E2E)

**Non-functional requirements:**
- Bundle size targets
- Lighthouse performance score targets
- Test coverage minimums per phase
- Accessibility compliance level (WCAG)

## Constraints on the Output

- Reference the actual project files and structure — do not produce generic Angular advice
- Use the Backend architecture as the quality reference, not as a template to copy (different framework, different patterns)
- Each recommendation must be actionable with a clear "done" state
- Respect the existing technology choices: Angular 22 standalone components, Signals API (no RxJS), TypeScript 6, Tailwind CSS, Vitest
- The three services are well-structured and should be preserved in spirit — the refactoring wraps them in proper Angular patterns, not replaces them
