# PaySim-inspired identity and payment investigation

An account can look ordinary while its identity and payment paths reveal a wider pattern. Begin with shared identifiers, then follow transfers and cash-outs. Which similarities are useful evidence, and which simply describe people living together?

## Run

```bash
./gxr up paysim-schemaless
./gxr verify paysim-schemaless
./gxr connect up paysim-schemaless
./gxr export paysim-schemaless
```

Run these commands from the repository root. The graph is `paysim` in the
`kineviz` database. The default fixture creates 13,666 vertices and 25,266 edges.
See [the main quick start](../../README.md) for prerequisites.

## Model

Seven vertex labels: `client`, `transaction`, `merchant`, `bank`, `ssn`, `email`, and `phonenumber`. Clients `performs` transactions, which link through `to_client`, `to_merchant`, or `to_bank`. Identity relationships are `has_ssn`, `has_email`, and `has_phone`.

AGE stores flexible property maps and creates backing tables for labels. The inherited demo name does not imply Spanner-style dynamic-label tables. New properties need no column migration. For Kafka replay, use [streaming/](../../streaming/README.md); it writes a separate graph, `paysim_stream`.

## Investigate

- [Which identities are shared by multiple clients?](queries/01-shared-identifiers.sql) — [canvas columns](queries/canvas/01-shared-identifiers.sql)
- [Which shared identities also connect clients who transfer money?](queries/02-fraud-rings.sql) — [canvas columns](queries/canvas/02-fraud-rings.sql)
- [Which clients receive large payments from several sources?](queries/03-collector-accounts.sql) — [canvas columns](queries/canvas/03-collector-accounts.sql)
- [Where do funds reach high-risk merchants?](queries/04-cash-out.sql) — [canvas columns](queries/canvas/04-cash-out.sql)

```bash
./gxr query paysim-schemaless demos/paysim-schemaless/queries/01-shared-identifiers.sql
```

The analytical files return tables. Their `canvas/` counterparts return flat
source/target columns for Kineviz Mapping Editor and limit output to 500 rows.
Use [the optional SQL route](../../connect/SQL.md) to map them. The CSV export
includes the complete graph as well as these smaller result sets.

## Verification and lifecycle

Verification checks all seven AGE vertex labels, finds the planted ring evidence, and asserts that the innocent family's members are absent from the shared-identity transfer matches. The 12,033 transactions include synthetic ground-truth flags; neither the queries nor Kineviz predict those labels.

All eight query files must return results, and total graph counts must match the
registered seed. Repeating `up` preserves the graph. To deliberately recreate
this demo, run `./gxr down paysim-schemaless --yes` followed by `./gxr up paysim-schemaless`.
Other graphs are preserved. `./gxr db stop` keeps the database volume.

## Live graph queries

Use Database Proxy as described in the [connection guide](../../connect/README.md).
Paste the Cypher files in [`queries/graph/`](queries/graph/) into Kineviz's
**Query** tab. They return nodes, edges and paths directly; the SQL files remain
available for tables and manual mapping.
