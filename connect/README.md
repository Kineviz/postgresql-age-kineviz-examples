# Connect Kineviz directly to Apache AGE

Use a Kineviz build with **Apache AGE** in **New project → Your database**.
Kineviz connects directly to PostgreSQL and runs openCypher through AGE. The
example database, queries, schema discovery, canvas pulls and neighborhood
expansion use this native connector. No Database Proxy service or API key is
needed. PostgreSQL SQL/PGQ is a different connector.

## Prepare a graph

From the repository root, with Docker running:

```bash
./gxr up paysim-schemaless
./gxr connect up paysim-schemaless
```

For the live payment replay instead:

```bash
./gxr stream prepare
./gxr connect up paysim-stream
```

`connect up` checks that the graph belongs to this example, prepares a restricted
native login, adds traversal indexes, tests password authentication and a graph
query, and prints the connection fields. It never starts a proxy or clears data.
Repeating the command preserves credentials and reuses existing indexes.

## Enter these fields in Kineviz Desktop

Select **Apache AGE** and enter:

| Field | Value |
|---|---|
| Host | `127.0.0.1` (no `http://`, path or port here) |
| Port | `5455`, or `AGE_PORT` from `.env` |
| Database | `kineviz` |
| Graph Name | `paysim_stream` for replay; `paysim` for the batch dataset |
| Username | `kineviz_native_reader` |
| Password | The value of `KINEVIZ_NATIVE_PASSWORD` in this repository's private `.env` |

Use the password value, not the variable name. Keep database writes disabled in
the project settings. Other graph names are:

| CLI demo argument | Graph Name |
|---|---|
| `fraud-rings` | `fraud_rings` |
| `edge-fleet` | `edge_fleet` |
| `paysim-schemaless` | `paysim` |
| `paysim-stream` | `paysim_stream` |

Graph Name is an AGE graph, not a project title or URL suffix. These four graphs
share one PostgreSQL database. Use a separate Kineviz project for each graph you
want to explore independently.

In the project's **Query** tab, run plain Cypher:

```cypher
MATCH (n)-[r]->(m)
RETURN n, r, m
LIMIT 50
```

Nodes and edges render directly on the canvas. No SQL wrapper or manual mapping
is required. The [`queries/graph/`](../demos/paysim-schemaless/queries/graph/)
files return nodes, edges and paths. Use explicit returned variables; the native
connector cannot determine the result columns of `RETURN *`. Avoid predicates
such as `id(n) IN [...]`; the native connector's generated expansion queries
handle AGE's internal ID restrictions.

## Native reader and existing installations

`connect up` generates `KINEVIZ_NATIVE_PASSWORD=age_…` only when missing, and
creates `kineviz_native_reader`. It inherits the existing `kineviz_reader` SELECT
grants and defaults to read-only sessions with the AGE search path. It is not a
superuser. Existing `KINEVIZ_PASSWORD`, administrator passwords, proxy keys,
graphs, Kafka receipts and volumes are preserved.

The prefix avoids a legacy Kineviz credential heuristic that treats long
alphanumeric plaintext passwords as encrypted values. The original example
passwords were hexadecimal, which can fail at this boundary even when direct
PostgreSQL authentication succeeds. Use the newly printed native account rather
than copying the old proxy API key or administrator password.

AGE is installed in `kineviz` and preloaded in each server session by Compose.
Some native connector builds attempt `LOAD 'age'` even when already preloaded;
a non-superuser can receive `access to library "age" is not allowed`. The bundled
preload and role search path allow the subsequent queries to run. Do not make the
visualization account a superuser to address this message. For your own server,
have its administrator install AGE, configure session preloading/search path and
grant SELECT on the intended graph's label tables.

## Migrate an existing Database Proxy project

1. Update this repository and run `./gxr connect up paysim-stream` (or your batch
   demo argument). No graph reload or reset is needed.
2. In the existing project's database settings, change the type to **Apache AGE**
   and enter the six fields above. Choose `paysim_stream` to keep replay behavior.
   If your build does not allow changing database type, create a new Apache AGE
   project and keep the old project for its saved views.
3. Reopen the project and run the example Cypher query. Reinstall the adapted
   dashboard into that native project:

   ```bash
   ./demos/paysim-schemaless/scripts/install-dashboard.sh PROJECT_ID
   ```

4. After native queries work and no project still uses the old proxy, stop only
   that legacy service with `./gxr proxy down`. Its configuration volume is kept.

Changing the connection does not rewrite saved views or remove nodes already on
the canvas. The installer backs up an edited dashboard before replacing it and
preserves other dashboard entries. The native installer deliberately refuses to
install into a Database Proxy project or the wrong database/graph.

The former proxy integration remains available only through the explicit
[`./gxr proxy …` compatibility commands](LEGACY-PROXY.md). New installations do
not need them. `./gxr connect down` now explains that a native connection has no
separate service; use `./gxr db stop` if you intend to stop PostgreSQL.

## Verify and troubleshoot

```bash
./gxr connect status paysim-stream
./gxr db status
npm run test:native       # after npm ci and loading all three demos + stream prepare
npm run test:dashboard    # checks all dashboard queries without a proxy
```

- **The database returned an unrecognized error:** check all six native fields,
  especially Graph Name and the native username/password. Run `connect status`
  to separate database authentication/query failures from a Desktop issue. The
  generic banner alone does not identify the cause.
- **Graph not found:** `paysim-stream` is a CLI argument; the graph is
  `paysim_stream`. Likewise, the batch graph is `paysim`.
- **Authentication failed:** use `KINEVIZ_NATIVE_PASSWORD` with
  `kineviz_native_reader`. If its `.env` value was lost or changed, restore it;
  `connect up` deliberately does not rotate an existing native role's password.
- **No Apache AGE option:** update Kineviz to a build containing native AGE.
  This repo does not install or upgrade Kineviz.
- **Cannot reach localhost:** the database is loopback-only. Desktop must run on
  this machine; on a server deployment, the Kineviz backend must be able to reach
  PostgreSQL. Do not put the former proxy URL into Host or expose the database
  publicly to solve this.
- **Dashboard totals do not change:** confirm Graph Name is `paysim_stream` and
  the replay is running. The batch graph stays static.

The pinned PostgreSQL 16 / AGE 1.6 data volume is retained. This migration does
not upgrade the PostgreSQL major version. See [validation](../docs/VALIDATION.md)
for the measured database and Desktop checks.

## CSV and SQL alternatives

`./gxr export <demo>` writes the whole graph and per-label CSV files under
`exports/<demo>/`. Use the Mapping Editor for an offline snapshot, preserving
node IDs and edge IDs so parallel payments remain distinct. The optional
[SQL panel](SQL.md) uses the `.sql` files and explicit column mappings; the
native project's Query tab uses the `.cypher` files.
