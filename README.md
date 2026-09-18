# PostgreSQL + Apache AGE + Kineviz

Run a property graph in PostgreSQL, investigate it with Apache AGE's openCypher,
and bring the results into Kineviz. Three deterministic examples, a local Docker
setup, SQL queries, CSV exports, and a Kafka payment replay are included.

Adapted from [Kineviz's Spanner Omni examples](https://github.com/Kineviz/spanner-omni-kineviz-examples).
The datasets and investigative questions carry over. The runtime and queries use
PostgreSQL + [Apache AGE](https://github.com/apache/age).

> Kineviz was formerly named GraphXR. Some URLs and application surfaces retain that name.

## Two ways in

- **Already have an AGE graph?** Start with [connecting Kineviz](connect/README.md).
- **Want a working example?** Run the quick start below.

## Quick start

Requires Docker with Compose v2 (`up --wait` support), Node.js **22.18+**, Python
**3.9+**, and a Bash shell. Use WSL2 on Windows. No cloud account or host PostgreSQL
installation is needed. `npm install` is unnecessary for the basic demo commands.

```bash
git clone https://github.com/Kineviz/postgresql-age-kineviz-examples.git
cd postgresql-age-kineviz-examples
./gxr up fraud-rings
./gxr connect up fraud-rings
./gxr export fraud-rings
```

`up` creates a private `.env` with random passwords if missing, starts the pinned
container, generates the data, creates the graph in a transaction, and verifies
the expected findings. Repeating it preserves an existing owned graph and checks
it again. It does not silently reset changes you made.

PostgreSQL listens only on **127.0.0.1:5455**. `connect up` starts the pinned
Kineviz database proxy with an AGE driver on **127.0.0.1:9081**, registers the
graph, verifies it, and prints the API URL. In Kineviz, choose **Database Proxy**
and use that URL plus `PROXY_API_KEY` from `.env`. Cypher results become nodes
and edges directly, with schema discovery and neighborhood expansion.
See the [complete connection instructions](connect/README.md).

## Demos

| Demo | Question | Default graph size |
|---|---|---|
| [fraud-rings](demos/fraud-rings/) | Which shared devices also connect accounts that move money between themselves? | 620 vertices / 3,319 edges |
| [edge-fleet](demos/edge-fleet/) | What fails when one gateway, technician, or firmware build becomes unavailable? | 954 vertices / 2,012 edges |
| [paysim-schemaless](demos/paysim-schemaless/) | Which shared identities and payment paths deserve investigation? | 13,666 vertices / 25,266 edges |

All data is synthetic. `isfraud` is planted ground truth for validation, not a
model's prediction. The PaySim example is inspired by PaySim; it is not a copy of
its original dataset or simulator. The fleet's advisory identifier is fictional.

Each demo includes four analytical SQL queries and four tabular queries for
Kineviz. Start with a question; change a threshold or follow a relationship to
see what the first result leaves unanswered. Canvas queries cap results at 500
rows. CSV export also includes the complete graph, including isolated vertices.

## What changes from Spanner Omni

| Spanner example | This repository |
|---|---|
| Spanner Omni container and CLI | Official PostgreSQL 16 + AGE 1.6 image, pinned by multi-architecture digest |
| `CREATE PROPERTY GRAPH`, GoogleSQL/GQL | `create_graph`, AGE label tables, openCypher in `cypher()` |
| Spanner database proxy | Same upstream proxy, pinned with an AGE driver; CSV alternative |
| Dynamic-label node/edge tables | AGE labels and flexible `agtype` property maps |
| Kafka → Spanner sink | Kafka → PostgreSQL transaction + AGE graph mutation |
| Preview expiry and Spanner resource limits | Normal persistent PostgreSQL volume; no Spanner expiry |

The retained name `paysim-schemaless` identifies the corresponding example. AGE
creates a PostgreSQL table for each label; it does **not** reproduce Spanner's
single dynamic node table and single dynamic edge table. New properties need no
column migration. A new label creates a new backing relation.

Kineviz's PostgreSQL **property-graph** connector uses SQL/PGQ (`GRAPH_TABLE`),
which is a different interface. This repo connects AGE through Database Proxy; it does not add a native AGE
connector. The [PaySim dashboard](demos/paysim-schemaless/kineviz/) is adapted
with AGE queries; the original Spanner project archive is not reused. An optional
[SQL panel route](connect/SQL.md) remains available for tabular results.

## Commands

```bash
./gxr list
./gxr up edge-fleet
./gxr up paysim-schemaless
./gxr verify paysim-schemaless
./gxr query fraud-rings demos/fraud-rings/queries/02-money-cycles.sql
./gxr export paysim-schemaless
./gxr connect up paysim-schemaless
./gxr connect status paysim-schemaless
./gxr connect down                  # stops only the proxy
./gxr db status
./gxr db stop                       # stops PostgreSQL; keeps data
./gxr db start                      # resumes it
./gxr down fraud-rings --yes         # explicitly removes only this demo graph
```

To recreate a demo, use its explicit `down ... --yes` command followed by `up`.
Other demo graphs and the volume remain intact. An unregistered graph with a
reserved demo name is refused rather than replaced.

## PaySim dashboard

After connecting a PaySim Database Proxy project in Kineviz Desktop:

```bash
./demos/paysim-schemaless/scripts/install-dashboard.sh
```

Open **Dashboard → PaySim · PostgreSQL + AGE**. The installer finds the matching
project, saves the 14-widget dashboard, and preserves other library entries.
[Load instructions and replay behavior](demos/paysim-schemaless/kineviz/README.md).

## Streaming replay

```bash
./gxr stream prepare
./gxr stream up
./gxr stream status
./gxr stream down
```

The replay uses a separate graph, **`paysim_stream`**, and leaves `paysim` intact.
It seeds actors and identifiers, then replays 12,033 generated transactions
through Kafka. A receipt and graph mutation commit together before Kafka advances
the consumer offset. Replaying the same event does not duplicate it.
Details and progress queries: [streaming/README.md](streaming/README.md).

## Resources and limits

Budget a few GB of Docker disk and memory for this small demo. Kafka adds a JVM
and another image. Initial downloads and the larger graph load can take several
minutes; the [verification record](docs/VALIDATION.md) distinguishes tested paths
from UI steps. There are no cloud resources created or billed by these scripts.
Kineviz itself has separate installation, account, and licensing requirements.

The checked AGE image supports Linux ARM64 and AMD64. The upstream `master`
manual and repository can describe different version ranges or newer behavior;
the executable queries here target the pinned image. AGE needs to be installed
on the PostgreSQL server: ordinary PostgreSQL compatibility does not imply that
a managed provider supports AGE.

## Development

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run test:integration             # requires Docker; loads all three demos
npm run test:stream                  # Kafka replay + complete graph comparison
npm run test:proxy                   # proxy API + graph operations on all demos
npm run test:dashboard               # ten dashboard queries + empty replay state
```

The CLI, loaders, streaming runtime, and integration tests are TypeScript and
run directly under Node's type stripping. The small drop-in AGE proxy driver is
Python because the upstream proxy requires that interface. The three unmodified Python generators are attributed, MIT-licensed
fixtures from the source repository. See [vendor/README.md](vendor/README.md).
CI runs the unit and database integration checks. See [CONTRIBUTING.md](CONTRIBUTING.md),
[AGENTS.md](AGENTS.md), and [troubleshooting](docs/TROUBLESHOOTING.md).

## References

- [Apache AGE source and releases](https://github.com/apache/age)
- [AGE manual](https://age.apache.org/age-manual/master/index.html)
- [Setup and session initialization](https://age.apache.org/age-manual/master/intro/setup.html)
- [SQL / Cypher query format](https://age.apache.org/age-manual/master/intro/cypher.html)
- [Kineviz Desktop](https://github.com/Kineviz/kineviz-desktop/releases)

[MIT license](LICENSE). Apache AGE and PostgreSQL retain their respective upstream licenses.
