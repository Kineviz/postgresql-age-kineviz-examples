# Troubleshooting

**Docker unavailable:** start Docker Desktop or your Docker engine, and confirm
`docker info` works for the current user. Compose v2 must support `up --wait`.

**Port 5455 is in use:** edit `AGE_PORT` in this repo's `.env`, then run
`./gxr db start`. Use that port in Kineviz. Do not stop someone else's database.

**First load seems slow:** image downloads and PaySim graph creation can take
several minutes. Wait for verification. Don't run a second setup in parallel.
`docker compose logs --tail 50 db` shows server errors. A failed transaction
doesn't leave half a graph; rerun `up` after correcting its reported error.

**Existing graph is refused:** a graph with the reserved name exists but is not
registered as this repo's demo. Choose a separate Compose project/volume. Do not
drop an unfamiliar graph. `COMPOSE_PROJECT_NAME` and `AGE_PORT` can isolate a
separate checkout.

**Counts or findings changed:** `up` preserves existing data. If you intentionally
changed a demo, verification can fail. Export anything you need, then explicitly
run `./gxr down <demo> --yes` and `./gxr up <demo>` to recreate only that graph.

**Authentication fails after editing `.env`:** `POSTGRES_PASSWORD` initializes a
new PostgreSQL volume; changing the variable does not rotate an existing
administrator password. Restore the original value or rotate the database role
deliberately. `./gxr db start` applies the current `KINEVIZ_PASSWORD` to the reader
role. Never delete the volume as a password-recovery shortcut.

**`cypher` missing / `agtype` not found:** install AGE in the connected database
and initialize the session. The bundled deployment handles this automatically.
See [connect/README.md](../connect/README.md).

**Kineviz rejects PostgreSQL version / asks for `GRAPH_TABLE`:** the selected
connector is the SQL/PGQ property-graph connector. For AGE run `./gxr connect up
<demo>` and choose **Database Proxy**. See [connect](../connect/README.md).

**Host not allowed in Query → SQL:** the SQL backend rejected the host against
its allowlist before database authentication. The Database Proxy route above is
a separate transport. For SQL, an administrator must allow the specific host;
the Server field must include the port, for example `127.0.0.1:5455`.

**Proxy connection fails:** run `./gxr connect status <demo>`. Confirm the URL
uses port 9081 (or `PROXY_PORT`) and the API key is `PROXY_API_KEY`. See the
[proxy troubleshooting guide](../connect/README.md#troubleshooting-the-connection).

**No rows after `LOAD; SET; SELECT` in a GUI:** the client may only handle one
result object. Use per-session server initialization and a single SELECT, as
the bundled queries do.

**Casting AGE numbers to JSON fails:** cast to `bigint`, `float8`, or `boolean`
as appropriate; cast strings to `text`. The pinned release does not support a
universal scalar `agtype::json` conversion.

**Stream stopped or lagging:** `./gxr stream status` reports containers, landed
transaction count, and producer/sink progress. Inspect `docker compose -f
compose.yaml -f streaming/compose.yaml logs --tail 100 sink producer broker`.
Invalid events stop consumption and remain retryable; fix their cause rather
than skipping offsets. `./gxr stream up` starts stopped services without clearing
the graph, Kafka log, or receipts. It can replay a completed producer again;
receipts prevent duplicate graph writes.

**Stopping everything:** run `./gxr connect down` and `./gxr stream down` before `./gxr db stop`. These
commands keep both data volumes. There is intentionally no automatic whole-volume
destroy command in the demo CLI.
