# Connect Kineviz to PostgreSQL + Apache AGE

Following the [Spanner Omni connect example](https://github.com/Kineviz/spanner-omni-kineviz-examples/tree/main/connect),
this directory provides a live **Database Proxy** route and a CSV snapshot route.
Kineviz was formerly named GraphXR; the proxy repository retains that name.

| Route | Result | Use it for |
|---|---|---|
| A — Database Proxy | Live Cypher, graph schema, nodes and edges, neighborhood expansion | Exploring and querying repeatedly |
| B — CSV export | A snapshot with explicit mappings | Offline sharing and one-off imports |

Kineviz's **PostgreSQL SQL/PGQ** option uses a different graph interface. Choose
**Database Proxy** for this setup. No new dropdown entry or Kineviz rebuild is
required for a client supporting the proxy's typed graph operations.

## Route A — live graph through Database Proxy

### Run a demo and start its connection

From the repository root, with Docker running:

```bash
./gxr up paysim-schemaless
./gxr connect up paysim-schemaless
```

The second command:

1. Builds the upstream Kineviz database proxy at commit
   `6229afd57ef71ce662a90caef25ebccc101f0915` with the drop-in AGE driver in
   [`proxy/age_driver.py`](proxy/age_driver.py).
2. Starts only the proxy, published on **127.0.0.1:9081**. PostgreSQL remains
   on **127.0.0.1:5455**. The two containers communicate over the Compose network.
3. Adds ID and endpoint indexes to owned demo labels for canvas traversals,
   then registers the graph without replacing an existing registration.
4. Verifies `/test`, `/graphSchema`, and a real graph query before printing the URL.

Docker packages the Python driver and upstream dependencies; no host virtualenv
or proxy frontend build is needed. The first build needs network access.
Subsequent builds reuse Docker's cache. Dependency versions are recorded in
[`proxy/requirements.lock`](proxy/requirements.lock). The driver registration is applied to the
pinned checkout inside the image, not to another local proxy installation.

`connect up` adds random `PROXY_API_KEY` and `PROXY_ADMIN_PASSWORD` values to
`.env` when absent. New API keys start with `gxr_` for compatibility with older
Kineviz credential handling; existing keys and passwords are preserved. Database credentials stay
in the proxy container; the project registration references its environment
variable rather than saving the database password in `projects.json`.

### Point Kineviz at it

In Kineviz Desktop, **Create New Project → Database Type → Database Proxy**:

| Field | PaySim value |
|---|---|
| API URL | `http://127.0.0.1:9081/api/age/paysim-schemaless` |
| API Key | `PROXY_API_KEY` from this repository's `.env` |

Use the API key, not either PostgreSQL password or the proxy admin password.
The URL ends with the **proxy project name**, not the AGE graph name.

| Demo | URL suffix | AGE graph |
|---|---|---|
| `fraud-rings` | `/api/age/fraud-rings` | `fraud_rings` |
| `edge-fleet` | `/api/age/edge-fleet` | `edge_fleet` |
| `paysim-schemaless` | `/api/age/paysim-schemaless` | `paysim` |

Run `./gxr connect up <demo>` for each graph you want to register. They share one
proxy container. In the project's **Query** tab, enter Cypher directly:

```cypher
MATCH (n)-[r]->(m)
RETURN n, r, m
LIMIT 50
```

The result is a graph on the canvas; no SQL wrapper or Mapping Editor is needed.
The schema comes from AGE labels and the data's relationship endpoints. Pull a
category or expand selected nodes to continue investigating. Each demo also has
[`queries/graph/`](../demos/paysim-schemaless/queries/graph/) examples that return
entities and paths, ready to paste into this tab.

### Verify and manage

```bash
./gxr connect status paysim-schemaless
./gxr connect down                   # stops only the proxy; preserves everything
./gxr connect up paysim-schemaless    # resumes and verifies
npm run test:proxy                   # all three graphs must already be loaded
```

The status command with a demo repeats the connection/schema/query checks.
Inspect logs with:

```bash
docker compose -f compose.yaml -f connect/compose.yaml logs --tail 50 proxy
```

API calls use `X-API-Key`. The endpoints used by Kineviz are:

| Method | Endpoint suffix | Purpose |
|---|---|---|
| POST | `/test` | Reach the configured AGE graph |
| GET | `/graphSchema` | Categories, properties and relationship endpoint categories |
| POST | `/query` | `{ "query": "MATCH (n) RETURN n LIMIT 10", "parameters": {} }` |
| GET | `/capabilities` | Supported graph operations |
| POST | `/pullCategory`, `/pullRelationship`, `/expand` | Canvas pulls and expansion |

### Driver behavior and boundaries

The driver initializes each connection's search path, uses read-only transactions
and the restricted `kineviz_reader` role, and closes the connection after each
request. Queries have a 15-second timeout and a 20,000-row result ceiling.
It also rejects mutation clauses and procedure calls before execution: AGE 1.6's
`SET` path is not stopped by the read-only session preference alone.

AGE's annotated `agtype` values become graph entities, including values nested in
lists, maps and paths. Identities are decimal strings so JavaScript cannot round
64-bit IDs. Kineviz's quoted numeric ID predicates are normalized only at
`id(variable)` comparisons, including internal-relationship queries. Edge-only
results fetch missing endpoint nodes. Returning scalar
values gives a table; returning entities gives a graph. For a mixed result,
entities go to the graph and scalar columns are not displayed there.

Use explicit `RETURN n, r, m` with `WITH`, `UNWIND` or `UNION`. Simple
`MATCH ... RETURN *` is supported; complex wildcard scope is rejected with an
explanation. Parameters are substituted only at lexed `$parameter` tokens using
Cypher literals, never inside quoted strings or comments. The complete Cypher
query uses a collision-free SQL dollar delimiter.

Schema properties are sampled from up to 500 rows per label; labels and populated
relationship endpoint combinations are discovered from the database. An empty
edge label has no discoverable endpoints until data is loaded. This first driver
targets labeled graphs. Full-text indexes, graph editing and database switching
are not provided. The proxy may cache schema briefly; `/graphSchema?refresh=true`
forces a reload.

Multi-hop expansion uses AGE variable-length paths and includes paths of one
through the requested number of hops (at most five). Filters apply to every edge
in the path.

Use a recent Kineviz build supporting the proxy's `/capabilities` and typed
`/expand`/`/pullCategory`/`/pullRelationship` endpoints. Older builds may execute
handwritten queries but generate incompatible expansion statements. Verification
of the HTTP contract and a limitation in Kineviz's legacy internal-edge helper
are recorded in [VALIDATION.md](../docs/VALIDATION.md), along with the separate
Desktop query verification and its application fixes.

If an older Desktop build reports `String contains non ISO-8859-1 code point`
after saving an all-hexadecimal API key, its credential handler may have mistaken
the key for encrypted data. The ensuing `schema.maps.forEach is not a function`
warning comes from Kineviz's empty schema placeholder. Use a Kineviz build with
the proxy-key encryption fix, or use a prefixed API key consistently in the
proxy's `.env` and every connected project's settings. Updating this repository
does not rotate existing keys or update the Desktop application automatically.

### Connect your own AGE graph

The drop-in driver is registered as `DatabaseType.AGE`, leaving the upstream
PostgreSQL/SQL-PGQ and other driver names alone. [`proxy/install.py`](proxy/install.py)
shows the two registrations and local-network preflight setting applied to the
pinned upstream source. Python is
used only where that upstream interface requires it.

Build/run the same proxy image with access to your database. Its project API
accepts this configuration (replace the example values):

```json
{
  "name": "my-age-graph",
  "database_type": "age",
  "database_config": {
    "type": "age",
    "host": "your-postgres-host",
    "port": 5432,
    "database_id": "your-database",
    "graph_name": "your-graph",
    "username": "your-reader",
    "use_tls": true,
    "options": {"password_env": "AGE_READER_PASSWORD"}
  }
}
```

Set that password environment variable on the proxy container. Log in at
`POST /api/admin/login` with `{ "password": "your-admin-password" }`, then send
this configuration to `POST /api/project/create` with the returned token in
`X-Admin-Token`. Do not save secrets in a shell history or a tracked request file.
The Kineviz URL is then `/api/age/my-age-graph`. TLS uses certificate and hostname
verification; configure the container's trusted certificates for your server.
For the included Kafka replay, use `./gxr stream prepare` followed by
`./gxr connect up paysim-stream`. This creates a separate registration for
`paysim_stream` without changing the batch `paysim-schemaless` connection.

AGE must be preloaded in each reader session (the bundled database already does
this). Install the extension as an administrator and grant the reader access to
the graph's label tables. The details below apply to SQL and proxy routes alike.

## Troubleshooting the connection

- **Port 9081 is busy:** set `PROXY_PORT` in `.env` and rerun `connect up`. Do not
  stop an unrelated proxy. Copy the newly printed URL.
- **401:** use `PROXY_API_KEY` in Kineviz's API Key field. The admin password is
  deliberately different.
- **Graph not found:** load the demo first, and verify the project/graph mapping
  above. `paysim-schemaless` is the project; `paysim` is the graph.
- **Host not allowed in the SQL panel:** that is Kineviz's SQL-host allowlist.
  It is a different connection route. Use Database Proxy as documented here, or
  ask your administrator to allow the specific host for [the SQL route](SQL.md).
- **Cannot reach localhost:** run Desktop on the proxy's machine. Browser-based
  deployments also depend on local-network permissions and their origin policy.
  Do not expose PostgreSQL publicly to resolve a browser connection problem.
- **Write rejected:** intentional. Use the loader/streaming commands for writes;
  keep the visualization connection read-only.

## Route B — CSV snapshot

```bash
./gxr export fraud-rings
```

The generated `exports/fraud-rings/` folder contains:

- `nodes.csv` and `edges.csv`: complete graph with stable, globally distinct
  identifiers, categories, relationships, and JSON property maps.
- `nodes-<Label>.csv`: one file per category, with properties expanded into
  ordinary columns. Map `id` as the node key. `original_id` preserves a fixture's
  local ID when it has one.
- `01-…csv` through `04-…csv`: the same bounded, flat source/target results as the
  canvas SQL queries, ready for Mapping Editor.

For a first look, import `02-money-cycles.csv` and map the columns above. For the
complete graph, import each `nodes-<Label>.csv` with its category, then map
`edges.csv` using `source` and `target` to the existing node IDs. Preserve the
edge `id` for parallel relationships. The complete export retains isolated nodes.

## Your own PostgreSQL + AGE server

Install an AGE build matching the PostgreSQL major version. As the administrator,
install the extension in the target database:

```sql
CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
SET search_path = ag_catalog, public;
```

The `LOAD` and `SET` settings belong to a session, not a database. A GUI that
opens a fresh connection for each query needs server/role configuration or a
connection initialization hook. This repo uses the PostgreSQL startup setting
`session_preload_libraries=age` and sets the search path for all sessions. For
your own deployment, arrange this with its administrator; don't assume a prior
`LOAD` in psql initializes Kineviz's connections. See the
[official setup guide](https://age.apache.org/age-manual/master/intro/setup.html).

Use a role granted `CONNECT` on the database, `USAGE` on `ag_catalog` and your
graph schema, and `SELECT` on their tables. Grant access to new label tables as
you add them. Keep write permissions separate. The bundled reader is granted
table reads and defaults to read-only transactions; it has no table-write grants.

Verify with a single statement, substituting your graph name:

```sql
SELECT name::text AS name
FROM ag_catalog.cypher('your_graph', $$
  MATCH (n:Person) RETURN n.name LIMIT 10
$$) AS (name agtype);
```

SQL clients need a declared `agtype` result column for each returned Cypher
expression. Cast each to an appropriate SQL type (`text`, `bigint`, `float8`,
`boolean`) before mapping. On the pinned release, a blanket `agtype::json` cast
does not support all scalar types.

Kineviz's backend must be able to reach the server. `127.0.0.1` means the machine
running that backend: it works for local Desktop, not a remote hosted Kineviz
server. A containerized Kineviz backend may need `host.docker.internal` or a
shared Docker network. Follow your deployment's network policy; do not expose
this demo's database publicly just to make a remote frontend reach it.
