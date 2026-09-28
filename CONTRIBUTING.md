# Contributing

Use synthetic or appropriately licensed public data. Keep the setup local and
reproducible. Each demo needs a graph name, generator adapter, analytical queries,
canvas-friendly SQL queries, a README, and assertions about its planted findings.

Run `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`, and
`npm run test:integration`. Run `npm run test:native` and `npm run test:dashboard` after database integration
for connection changes. These use Docker and the native restricted reader,
without a proxy. `npm run test:proxy` is optional coverage for the legacy route. Use an isolated Compose project and port
if your local examples contain personal work.

Explain compatibility changes against a pinned PostgreSQL/AGE pair. Don't update
image versions just to make a failing query disappear. Include the exact query
and observed error in an issue or pull request.
