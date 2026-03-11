# Copilot Guide

Keep suggestions aligned with the repo's deployment targets (Cloud Run) and minimal client exposure of secrets.

## Documentation
-  put new docs in `docs/*` (unless they belong in the top-level i.e. `README.md`)
- `docs/*`: documentation and resources.

## Constraints

- Use `VITE_`-prefixed environment variables for client-visible config.
- Avoid adding server-side runtime dependencies unless explicitly requested.

## Preferred updates

- Small, targeted changes.
- Keep dev and prod behavior consistent.

## Additional Resources

- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Vite Documentation](https://vitejs.dev/guide/)
- [Angular Documentation](https://angular.io/guide)
