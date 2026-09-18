# Dependencies across an edge fleet

An inventory tells you which devices exist. Relationships reveal what stops working when a gateway goes down, one technician becomes unavailable, or a firmware advisory reaches a site. Follow those dependencies to ask how far the consequences travel.

## Run

```bash
./gxr up edge-fleet
./gxr verify edge-fleet
./gxr connect up edge-fleet
./gxr export edge-fleet
```

Run these commands from the repository root. The graph is `edge_fleet` in the
`kineviz` database. The default fixture creates 954 vertices and 2,012 edges.
See [the main quick start](../../README.md) for prerequisites.

## Model

`Device → CONNECTED_TO → Gateway → HOSTED_AT → Site`; devices `RUNS` firmware, technicians `COVERS` sites, and devices `DEPENDS_ON` other devices.


## Investigate

- [Which gateway concentrates the largest share of devices?](queries/01-blast-radius.sql) — [canvas columns](queries/canvas/01-blast-radius.sql)
- [Which critical devices depend on a site with only one technician?](queries/02-lone-cover.sql) — [canvas columns](queries/canvas/02-lone-cover.sql)
- [How many sites share exposure to the same firmware build?](queries/03-advisory-exposure.sql) — [canvas columns](queries/canvas/03-advisory-exposure.sql)
- [Where do dependencies extend beyond the immediate attachment?](queries/04-cascade.sql) — [canvas columns](queries/canvas/04-cascade.sql)

```bash
./gxr query edge-fleet demos/edge-fleet/queries/01-blast-radius.sql
```

The analytical files return tables. Their `canvas/` counterparts return flat
source/target columns for Kineviz Mapping Editor and limit output to 500 rows.
Use [the optional SQL route](../../connect/SQL.md) to map them. The CSV export
includes the complete graph as well as these smaller result sets.

## Verification and lifecycle

Verification checks that the busiest gateway has more than twice the next gateway's device count and that a bounded dependency walk exposes a tail of at least three dependent devices. The advisory KEV-2026-0031 is a fictional fixture label, not a claim about a real vulnerability.

All eight query files must return results, and total graph counts must match the
registered seed. Repeating `up` preserves the graph. To deliberately recreate
this demo, run `./gxr down edge-fleet --yes` followed by `./gxr up edge-fleet`.
Other graphs are preserved. `./gxr db stop` keeps the database volume.

## Live graph queries

Use Database Proxy as described in the [connection guide](../../connect/README.md).
Paste the Cypher files in [`queries/graph/`](queries/graph/) into Kineviz's
**Query** tab. They return nodes, edges and paths directly; the SQL files remain
available for tables and manual mapping.
