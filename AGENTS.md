# Agent instructions

This repository contains PostgreSQL + Apache AGE examples for Kineviz (formerly
GraphXR). Read README.md and the chosen demo README before operating it.

- Use `./gxr up <demo>` for setup and `./gxr verify <demo>` for evidence.
- Report actual verification results; container startup alone is insufficient.
- Preserve `.env`, data volumes, and existing graphs. `up` preserves existing
  owned graphs. Never reset data or run `down --yes` without explicit user intent.
- The `paysim_stream` graph is independent of the batch `paysim` graph. Never
  clear either to hide a replay or verification failure.
- Keep PostgreSQL on loopback. Secrets belong only in gitignored `.env`.
- Use `./gxr connect up <demo>` and Kineviz Database Proxy for the live graph
  route. SQL panel mapping is an optional fallback. SQL/PGQ is not AGE.
- Preserve proxy registrations and its config volume. `connect down` stops only
  the proxy. Never stop another service to free its port.
- Use single SELECT files with typed scalar columns. Keep one declared `agtype`
  column per Cypher result. Read docs/ARCHITECTURE.md for release-specific syntax.
- Application and test code should be TypeScript, with explicit `.ts` imports
  and no enums or parameter properties requiring code generation. The drop-in
  files in `connect/proxy/` are Python to implement the upstream proxy interface.
- Keep the vendored Python fixtures unmodified; document their provenance.
- Run typecheck, unit tests, and database integration tests after runtime or
  query changes. Run `npm run test:proxy` for connection changes. Keep fixture
  checks independent of implementation shortcuts.
- Do not claim Kineviz UI verification unless you actually exercised the UI.
- Do not copy old Spanner dashboard/project archives into this repo as if they
  were adapted AGE assets.
