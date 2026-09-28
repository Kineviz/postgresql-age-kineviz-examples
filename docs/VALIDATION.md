# Verification record

## Authenticated native dashboard install — 2026-09-28

Verified in the running local Desktop development build and its real Files API:

- The unauthenticated project API returned HTTP 200 with `{status: 401}`.
  The installer now reports login/project-access requirements instead of claiming
  Desktop is missing. A regression test reproduced the old misleading error.
- Installation with an existing Kineviz API key succeeded in the native
  **Postgres AGE** project, connected to `paysim_stream`. Both dashboard files
  matched on readback. No credential was stored in either file.
- Opening the actual Dashboard library and dashboard showed all 14 widgets,
  **12,033 transactions**, **$11.06M** moved, **$321,337** fraud-labelled value,
  the suspect table, and a rendered daily area chart with fraud stacked on top.
  The existing completed replay and canvas were preserved; this was not a new
  timed replay run.
- TypeScript checking and **27 unit tests** passed. Tests cover authenticated
  project discovery and Files requests, HTTP-200 login failures, URL validation,
  and library preservation.
- Database integration passed for all three demos and 24 SQL queries. All ten
  dashboard sources matched fixture values and passed the empty-payment check
  inside a rolled-back temporary graph.
- All four native graph checks passed. The suite's final no-proxy assertion
  correctly found the intentionally retained legacy proxy in the user's main
  deployment, so the complete native suite was rerun successfully in the existing
  isolated test deployment. Only that test database was stopped afterward.

This Desktop check includes local GraphXR connector fixes for misleading
extension errors and cached old passwords. This examples repository does not
ship a patched Desktop application. The earlier migration-only check below
predates this rendered verification.

## Native Apache AGE migration — 2026-09-28

Verified on an isolated ARM64 Docker deployment with PostgreSQL **16.10** and
AGE **1.6.0**, using the unchanged pinned image and new native reader:

- TypeScript checks and all **24 unit tests** passed, including native project
  matching and dashboard backup/readback behavior.
- All three datasets and **24 analytical/canvas SQL queries** passed. Repeated
  setup preserved counts, exports retained endpoints, writes were denied and
  replay mutations remained idempotent.
- `npm run test:native` passed for `fraud_rings`, `edge_fleet`, `paysim` and
  `paysim_stream`: TCP authentication, incorrect-password rejection, catalog
  and property discovery, graph/path queries, exact ID selection, restricted
  privileges and repeat setup without credential rotation. No proxy was started.
- `npm run test:dashboard` verified **all ten sources** against fixture-derived
  totals through the native reader, then verified the zero-payment state inside
  a rolled-back temporary graph.
- The actual Kineviz native connection, translation, schema and result-mapping
  modules at GraphXR revision `e08995079bc4737cdbf9aa518746ec5c0114eb85` were
  separately bundled and exercised against this database. All four graph
  connections, all six example graph/path queries, and all ten dashboard queries
  on both batch and empty replay graphs passed. This test used a default test
  encryption configuration and plaintext prefixed credentials, not a running
  Desktop project or authenticated Files API.

The native migration was **not visually verified in Desktop** in this pass.
The installer is tested against the Files API contract with mocks; native project
matching uses Kineviz's current top-level `apacheAge` connection fields. The
native connector's denied `LOAD 'age'` attempt does not break these tests because
AGE is preloaded by the server and the reader search path is configured.

Reproduce database checks after `npm ci --ignore-scripts`:

```bash
npm run typecheck
npm test
npm run test:integration
npm run test:native
npm run test:dashboard
```

## Historical verification (Database Proxy workflow)

The records below describe the earlier proxy-based integration. New setups use
[native Apache AGE](../connect/README.md); legacy proxy commands are now
`./gxr proxy up|status|down`.

Verified locally on **2026-09-18**, using Docker Desktop on ARM64:

- PostgreSQL **16.10**, Apache AGE extension **1.6.0**.
- Official AGE multi-architecture manifest
  `sha256:16aa423d20a31aed36a3313244bf7aa00731325862f20ed584510e381f2feaed`.
- Apache Kafka **3.9.1** and Node.js **22.22.3** in the replay containers.
- Upstream fixture commit `fb395d58514836043b5daba0ea5e47448802864a`.

| Check | Observed result |
|---|---|
| Fraud-rings | 620 vertices, 3,319 edges; two ring devices and an excluded innocent family |
| Edge-fleet | 954 vertices, 2,012 edges; gateway concentration and dependency cascade |
| PaySim | 13,666 vertices, 25,266 edges; seven labels and family exclusion |
| SQL files | All 12 analytical and 12 canvas queries executed and returned results |
| Repeated setup | Existing graph counts preserved |
| CSV exports | Counts match; every edge endpoint exists in exported nodes |
| Reader connection | Single SELECT with real username/password succeeds without separate session setup |
| Reader INSERT/DELETE | SQL and Cypher CREATE rejected; disabling the role's read-only default still leaves direct table writes denied |
| Failed setup transaction | New graph creation rolled back with the transaction |
| Replay MERGE | Applying one transaction twice produces one vertex and two edges |
| Kafka full replay | 12,033 unique transactions landed; every vertex, edge, endpoint, and property matches the batch fixture |
| Kafka duplicate replay | 24,066 delivered events, 12,033 unique transactions; consumer lag 0 |
| TypeScript / unit checks | Type check and all four test groups pass |

Run the same checks with:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run test:integration
npm run test:stream
```

The original integration suite exercises PostgreSQL sessions equivalent to the Kineviz SQL
backend and validates the exact query files. **The SQL Mapping Editor was not
exercised in this validation.** The separate Desktop proxy check is recorded below. Mapping instructions
are provided separately. The original Spanner project archive is not included as an AGE-compatible asset.
The separately adapted AGE dashboard is verified below.

Local evidence above is ARM64. The GitHub Actions workflow also runs these checks
on Ubuntu; consult its result for the committed revision rather than assuming
that a local pass proves every platform.

## Database Proxy connection (2026-09-18)

The connection follows the Spanner Omni example: pinned upstream proxy,
drop-in driver, one-command registration, test/schema/query checks, and a
Database Proxy API URL. Upstream commit: `6229afd57ef71ce662a90caef25ebccc101f0915`.
Dependencies are pinned in `connect/proxy/requirements.lock`.

The proxy suite exercises every demo over real HTTP with the actual reader:

- Catalog labels and relationship endpoint categories.
- Nodes, edges, paths, nested entity lists/maps, and scalar tables.
- Exact graph IDs, including strings in Kineviz's internal-ID predicates.
- Endpoint completion for edge-only results.
- Category/relationship pulls, excluding already-loaded items.
- Incoming/outgoing/undirected expansion, one and two hops, relationship filters,
  hidden types, excluded IDs, and edges between selected nodes.
- All six ready-to-paste graph query files.
- Query errors, write rejection, API/admin authentication separation, browser
  private-network preflight, and connection cleanup after repeated requests.

The current Kineviz source adapter was also exercised directly against the
running proxy: connection probe, normalized schema, graph query, category pull,
two-hop expansion and selected-node edge expansion succeeded. This is a source
adapter integration check, **not a rendered Desktop UI test**.

One existing Kineviz helper remains a limitation: its legacy internal-relationship
query combines a directed edge pattern with `ID(n) < ID(m)`, which omits edges
whose source has a larger ID. The proxy preserves the meaning of that query.
Use normal expansion, the proxy's `onlyBetweenSelected` expansion intent, or an
explicit Cypher query without that ordering predicate for all edges among a
selection. The examples repository does not change Kineviz application code.

AGE 1.6's `SET` operation was observed to bypass the reader session's read-only
preference. A test added one temporary property to one synthetic fixture node;
it was removed and absence verified. The driver now rejects mutation/procedure
clauses before execution, and tests cover that guard. This corrects the broader
read-only claim in the original verification record.

## Rendered Kineviz Desktop check (2026-09-18)

Tested the local Kineviz Desktop 0.19.0 development build in the `Postgres + AGE`
project against `/api/age/paysim-schemaless`. This exposed an application bug:
the old encryption heuristic treated the generated 48-character hexadecimal key
as ciphertext, then corrupted it on read. The browser rejected its authentication
header before sending a request; the empty schema placeholder caused the secondary
`forEach` exception.

After fixing proxy-key encryption in Kineviz's SQLite and MongoDB save paths,
making schema conversion accept arrays and legacy object maps, and repairing the
saved key representation, the actual Desktop Query tab successfully ran:

```cypher
MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 50
```

The query reported **59 nodes, 50 edges, 0.15 seconds**. With "Load Inner
Relationship" enabled, the canvas showed **59 nodes and 51 edges**. Loaded
metadata contained all seven PaySim categories and seven relationship endpoint
pairs. Neither the invalid-header error nor the schema conversion warning
recurred. This verifies querying and schema loading in the rendered Desktop;
the expansion checks above remain source-adapter and HTTP tests.

The application fixes were made in the separate local Kineviz checkout; this
examples repository does not distribute a patched Desktop build. Newly generated
API keys now use a `gxr_` prefix to avoid the older encryption heuristic without
changing existing keys.


## Adapted PaySim dashboard and installer (2026-09-18)

The Spanner-style `demos/paysim-schemaless/scripts/install-dashboard.sh` entry
point now installs `kineviz/paysim-live.dashboard.json` through Desktop's Files
API. All ten database sources use AGE Cypher; the spec passes Kineviz's own
`validateDashboardSpec` validator. Type checking, all nine unit tests, the
existing database integration suite, and `npm run test:dashboard` passed locally.
The dashboard check compares every returned value and column name with independent
calculations from the generated fixture, then tests all ten queries with actors
and identifiers but zero payments in a temporary graph that is rolled back.
Installer tests cover project matching, ambiguous selection, first install,
reinstall, backup of edits, unrelated entries and pin preservation, and refusal
to treat an authentication/server error or malformed manifest as an empty library.

The installer detected the existing **Postgres + AGE** Desktop project, wrote the
spec and manifest, and read both back successfully. Opening **Dashboard →
PaySim · PostgreSQL + AGE** in the actual Electron application rendered:

- 12,033 transactions, $11.06M moved, $321,337 fraud-labelled value (rounded),
  $250,000 largest fraud-labelled payment, and 2.91% of payment value flagged.
- The daily area chart, shared-identity chart, account table, recipient rankings,
  amount bands, mule recipients, and merchant destinations.
- Four shared identifiers with direct-transfer evidence and four without it,
  matching the fixture independently; these are not fraud predictions.

This check used the completed batch graph through the existing AGE proxy.
The dashboard queries passed for the empty replay state, but this check did not
restart Kafka or claim to observe a new live replay in Desktop. The existing
canvas and database graphs were preserved. The separate local application fixes
and tested Desktop version described above still apply.


## Replay connection and reset command (2026-09-18)

`./gxr connect up paysim-stream` now registers `paysim_stream` separately and adds
its traversal indexes. The original `paysim-schemaless` registration continues
to point to batch `paysim`. The live dashboard installer defaults to the new
replay registration; an explicit `--proxy-project paysim-schemaless` retains the
batch option.

The existing **Postgres + AGE** Desktop project was switched to the stream URL.
The saved API key was verified unchanged after refreshing the running app worker
to load the earlier credential fix. The prior canvas was saved as **Batch snapshot
before replay connection** before refreshing the UI. The dashboard rendered
successfully, and proxy request logs confirmed its polling used
`/api/age/paysim-stream/query` with successful responses. Its already-complete
12,033-payment replay was preserved; no reset was performed on that user graph.

`npm run test:reset` creates a separate, randomly named Docker deployment with
its own PostgreSQL/Kafka volumes and credentials. It verifies:

- No lifecycle action without `--yes`.
- Reset before a Kafka consumer group exists.
- A seven-payment replay resets to zero payments, payment edges and receipts,
  with both writers left stopped.
- Exact actor, identity-edge and independent batch graph fingerprints survive.
- Starting only the sink after reset does not consume old messages into the graph.
- A fresh replay delivers exactly three payments and six edges, followed by a
  second successful reset. Test-owned volumes are removed afterward.

The test exposed delayed Kafka group release after stopping the container; the
reset now waits up to 45 seconds for the group to become inactive. Unit tests
also cover active groups, unowned graphs, Kafka failures, mismatched offsets,
and SQL rollback. Type checking, 14 unit tests, database integration, proxy
integration (including both PaySim registrations), dashboard checks, and the
isolated reset/replay test passed locally. These are local ARM64 results; check
GitHub Actions for the corresponding committed Linux result.
## Duration-based replay (2026-09-18)

`DEMO_TIME` now sets the producer's target duration in seconds (default 120),
using the actual selected CSV row count. The default no longer caps replay at
12,033 rows. `REPLAY_LIMIT` still supports a prefix. Pacing includes send time;
container startup and sink catch-up are outside the producer's clock.

- TypeScript checking and all 19 unit tests passed, including count/limit
  handling, invalid durations, empty input, and send-latency compensation.
- Database integration passed for all three demos and 24 queries, including
  preservation, export endpoints, reader permissions, rollback and idempotency.
- In a separate temporary Docker deployment, `DEMO_TIME=2` replayed seven
  payments in **2.002 seconds** and three payments in **2.001 seconds**. Both
  selected counts landed in AGE; the reset test also checks that old Kafka
  messages cannot refill a cleared graph and that actors/batch data survive.
- The updated dashboard instructions were installed in Desktop's **Postgres +
  AGE** project and matched the repository JSON exactly on readback. Its prior file was
  backed up. This check did not reset or restart the user's actual replay.

These timings measure the producer, not end-to-end dashboard completion. The
default full 120-second duration was covered by scheduling tests; the timed
Kafka checks used short prefixes, not a new full-duration UI recording.

## CLI replay progress (2026-09-18)

`./gxr stream status` now displays committed transaction progress, refreshing in
place in a terminal. `--once` gives one snapshot, `--watch` supports piped live
output, and `--details` retains the service/log/Kafka diagnostics.

- Type checking, all 24 unit tests, and database integration checks passed.
- The actual completed replay rendered **12,033/12,033, 100%, Complete** in
  both terminal and snapshot modes without changing its data.
- An isolated seven-payment replay refreshed from **Replaying** to **7/7,
  Complete**. Setting `REPLAY_LIMIT=999` on the monitor did not override the
  producer's actual limit of seven. Piped output contained no ANSI controls.
- Interrupting the monitor with SIGINT exited cleanly and left the producer
  running. Reset then rendered **0/7, 0%, Paused**, with actors, identity edges
  and batch data unchanged.
- Unit cases cover sink catch-up, failed/stopped writers, missing setup, an
  unavailable database, count mismatches, unknown/empty totals and extra
  existing rows. Incomplete counts are never rounded up to 100%.
