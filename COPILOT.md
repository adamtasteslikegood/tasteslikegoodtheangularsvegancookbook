# Copilot Guide

Keep suggestions aligned with the repo's deployment targets (Cloud Run) and minimal client exposure of secrets.

## Constraints

- Use `VITE_`-prefixed environment variables for client-visible config.
- Avoid adding server-side runtime dependencies unless explicitly requested.

## Preferred updates

- Small, targeted changes.
- Keep dev and prod behavior consistent.
