# Kafka → PostgreSQL + AGE payment replay

This replays the same synthetic transactions used by the batch PaySim graph.
It is a demonstration stream, not a connection to a live payment provider.

```bash
./gxr stream prepare
./gxr stream up
./gxr stream status
```

`prepare` generates the default fixture and seeds 1,633 actors/identifiers and
1,200 identity edges in `paysim_stream`. `up` starts an internal-only Kafka
broker, a producer, and an AGE sink. The producer sends 12,033 transactions at
100 events/second by default. The sink may need additional time to catch up.

`status` reports producer progress, landed receipts, and transaction vertices.
Completion means the producer exited successfully after 12,033 events **and**
both landed counts reach 12,033. A started container alone is not success.
Inspect the consumer group's lag directly when needed:

```bash
docker compose -f compose.yaml -f streaming/compose.yaml exec broker \
  /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server broker:9092 \
  --describe --group paysim-age-sink
```

The final graph has the same 13,666 vertices and 25,266 edges as batch `paysim`.
It does not overwrite or clear that batch graph.

To control pacing for a new/restarted producer:

```bash
REPLAY_RATE=500 ./gxr stream up
```

For a short trial use `REPLAY_LIMIT=100`; it is a prefix of the fixture and may
not include the planted fraud findings. Running again without that limit
replays the complete file; already-landed IDs are skipped. Keep the same
generated fixture while the stream is running.

## Inspect in Kineviz

Use the same SQL connection documented in [connect/](../connect/README.md), and
replace the graph argument `'paysim'` with `'paysim_stream'` in a PaySim query.
Repeat the SELECT to see newly landed payments. For an automatically refreshing dashboard, use the
[adapted PaySim dashboard](../demos/paysim-schemaless/kineviz/). Its database
sources use the current project connection: register `paysim_stream` in the AGE
proxy and connect that project to it before importing the dashboard. The default
`paysim-schemaless` proxy registration still targets the batch graph.

[`progress.sql`](progress.sql) is a single-query progress view. `isfraud` remains
synthetic ground truth; it is not a risk score produced by the sink.

## Delivery and stop behavior

PostgreSQL commits each event's receipt and graph mutation in one transaction.
Kafka offsets advance only after processing succeeds. Retrying the same event
does not duplicate its transaction node or two edges. A malformed event or
missing endpoint fails processing; its offset is not deliberately skipped.

The Kafka log and consumer offsets live in a named volume. Receipts and graph
data live in the PostgreSQL volume. Both must remain consistent if you perform
manual recovery. Don't clear receipts independently of the graph or replay a
different dataset using the same event IDs.

```bash
./gxr stream down       # stops producer, sink, broker; preserves both volumes
./gxr db stop          # optional: stops PostgreSQL too
```

This example uses a single broker, one partition, and one sink. It has no HA,
production dead-letter policy, schema registry, or production throughput claim.
