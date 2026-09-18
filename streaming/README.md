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

## Live dashboard in Kineviz

```bash
./gxr stream prepare
./gxr connect up paysim-stream
```

Create or update a **Database Proxy** project using the printed API URL,
`http://127.0.0.1:9081/api/age/paysim-stream`, and `PROXY_API_KEY` from `.env`.
This registration reads **`paysim_stream`**. The existing `paysim-schemaless`
registration continues to read the separate batch graph.

```bash
./demos/paysim-schemaless/scripts/install-dashboard.sh
REPLAY_RATE=50 ./gxr stream up
```

Open **Dashboard → PaySim · PostgreSQL + AGE**. Its database panels poll every
2–10 seconds. [Dashboard details](../demos/paysim-schemaless/kineviz/).
For SQL inspection, [`progress.sql`](progress.sql) returns the replay counts.
`isfraud` remains planted synthetic ground truth, not a sink-generated risk score.

## Start over

```bash
./gxr stream reset --yes
REPLAY_RATE=50 ./gxr stream up
```

`reset` requires `--yes` before taking any action. It stops the producer and sink,
starts the database/broker if necessary, and waits for the Kafka consumer group
to become inactive. It then moves that group's position to the current end of
`paysim-transactions`, so old queued messages cannot refill the cleared graph.
Only after verifying those offsets does it atomically clear `paysim_stream`'s
transaction vertices, the `performs` / `to_client` / `to_merchant` / `to_bank`
edges, and `public.replay_receipts`.

Actors, shared identifiers, identity edges, schema/indexes, credentials, volumes,
proxy registrations, and all batch graphs remain intact. The producer and sink
stay stopped after reset, so the dashboard shows zero until you run `stream up`.
Saved views and existing canvas data are retained; they are snapshots of earlier
query results, not a live mirror of the database.

If reset fails, writers stay stopped. A Kafka failure leaves payment data intact;
a SQL failure rolls back the clear. Resolve the reported cause and repeat the
same reset command before starting the replay. Do not run `up` concurrently with
`reset`, and do not clear just the receipts or just the graph by hand.

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
