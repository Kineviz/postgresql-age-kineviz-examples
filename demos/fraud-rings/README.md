# Shared devices and payment rings

A shared device can connect a payment ring—or an ordinary family. Start with the device, then ask whether its accounts move money between themselves. What extra evidence would justify investigating one group and clearing another?

## Run

```bash
./gxr up fraud-rings
./gxr verify fraud-rings
./gxr connect up fraud-rings
./gxr export fraud-rings
```

Run these commands from the repository root. The graph is `fraud_rings` in the
`kineviz` database. The default fixture creates 620 vertices and 3,319 edges.
See [the main quick start](../../README.md) for prerequisites.

## Model

`Client → USED_DEVICE → Device`, `Client → PAID → Client`, and `Client → PAID_MERCHANT → Merchant`. Each transfer remains a distinct edge with its amount and timestamp.


## Investigate

- [Which devices have several account holders?](queries/01-shared-devices.sql) — [canvas columns](queries/canvas/01-shared-devices.sql)
- [Which of those accounts also pay one another?](queries/02-money-cycles.sql) — [canvas columns](queries/canvas/02-money-cycles.sql)
- [Where do several large payments converge?](queries/03-collector-accounts.sql) — [canvas columns](queries/canvas/03-collector-accounts.sql)
- [Which paths end in a large merchant payment?](queries/04-cash-out.sql) — [canvas columns](queries/canvas/04-cash-out.sql)

```bash
./gxr query fraud-rings demos/fraud-rings/queries/01-shared-devices.sql
```

The analytical files return tables. Their `canvas/` counterparts return flat
source/target columns for Kineviz Mapping Editor and limit output to 500 rows.
Use [the optional SQL route](../../connect/SQL.md) to map them. The CSV export
includes the complete graph as well as these smaller result sets.

## Verification and lifecycle

Verification asserts three shared devices, two with transfers between their accounts, and the innocent family excluded from those transfer matches. The fixture also contains a closed four-account cycle; query 02 surfaces the shared-device transfer evidence, rather than claiming every matched pair is itself a complete cycle.

All eight query files must return results, and total graph counts must match the
registered seed. Repeating `up` preserves the graph. To deliberately recreate
this demo, run `./gxr down fraud-rings --yes` followed by `./gxr up fraud-rings`.
Other graphs are preserved. `./gxr db stop` keeps the database volume.

## Live graph queries

Use Database Proxy as described in the [connection guide](../../connect/README.md).
Paste the Cypher files in [`queries/graph/`](queries/graph/) into Kineviz's
**Query** tab. They return nodes, edges and paths directly; the SQL files remain
available for tables and manual mapping.
