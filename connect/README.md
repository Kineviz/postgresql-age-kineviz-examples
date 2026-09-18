# Connect PostgreSQL + AGE to Kineviz

Use **Query → SQL → PostgreSQL** for live tabular results, or import CSV for a
snapshot. The SQL panel requires you to map result columns to nodes and edges.
This route does not add automatic AGE graph-schema discovery or Cypher expansion
to Kineviz's native graph database connectors.

## Run a demo

```bash
./gxr up fraud-rings
./gxr connect fraud-rings
```

Create or open a Kineviz project. In the SQL query panel, select PostgreSQL:

| Field | Local demo value |
|---|---|
| Host/server | `127.0.0.1` |
| Port | `5455` (or `AGE_PORT` from `.env`) |
| Database | `kineviz` |
| User | `kineviz_reader` |
| Password | `KINEVIZ_PASSWORD` from `.env` |

Test the connection, then run the entire single `SELECT` in
[`02-money-cycles.sql`](../demos/fraud-rings/queries/canvas/02-money-cycles.sql).
It returns ordinary text/number columns. No session setup commands are needed
with this repository's container: it preloads AGE and configures `search_path`
for every connection.

In Mapping Editor, create these mappings:

| Columns | Mapping |
|---|---|
| `source_id` | Source node's unique identifier |
| `source_name` | Source node display property |
| `target_id` | Target node's unique identifier |
| `target_name` | Target node display property |
| `relationship` | Directed relationship from source to target |
| `edge_id` | Relationship identity, if supported by your mapping UI |
| `amount` | Relationship property |

The money-cycles result has `Client` at both ends and relationship `PAID`. Other
queries expose `source_label` and `target_label`; use them to choose the matching
categories. If the UI only supports a fixed category, map each label combination
separately. Preserve `edge_id` to distinguish parallel payments; a mapping that
merges only by endpoint pair will collapse distinct transfers.

Run a different SQL query when you want another neighborhood. These queries are
live when executed; the SQL panel does not turn a snapshot into an automatic
refreshing Spanner-style dashboard.

## CSV route

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
