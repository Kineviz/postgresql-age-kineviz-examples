# Optional SQL panel route

Create a project without a graph database connection, then open **Query → SQL →
PostgreSQL**. The SQL panel is a separate route that requires Mapping Editor.
For live graph queries and expansion, use [Database Proxy](README.md).

| Field | Value |
|---|---|
| Server | `127.0.0.1:5455` (include the port in this field) |
| Database | `kineviz` |
| Username | `kineviz_reader` |
| Password | `KINEVIZ_PASSWORD` from `.env` |

The backend serving Kineviz must allow and reach this host. **Host not allowed**
means its `allowedHosts` setting rejected the host before PostgreSQL was contacted.
An administrator should allow the specific database host under the deployment's
network policy. Do not disable the entire allowlist. `127.0.0.1` refers to that
backend's machine; a hosted server cannot use it to reach your laptop.

Run a complete `demos/<demo>/queries/canvas/*.sql` file. Map `source_id` and
`target_id` to node identifiers, `source_label` and `target_label` to categories,
`relationship` to the edge type, and `edge_id` to edge identity. Preserve edge
identity so distinct parallel payments are not merged. Map remaining columns to
properties. If the UI permits only fixed categories, map each category pair
separately. Results refresh when you run the query again.

The bundled database initializes AGE and its search path for every session.
Do not paste `LOAD; SET; SELECT` as a multi-statement query. The PostgreSQL
SQL/PGQ project type is a different connector and cannot query AGE graphs.
