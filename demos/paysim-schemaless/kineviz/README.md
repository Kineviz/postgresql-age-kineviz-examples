# PaySim dashboard for PostgreSQL + Apache AGE

[`paysim-live.dashboard.json`](paysim-live.dashboard.json) adapts the original
[Spanner PaySim dashboard](https://github.com/Kineviz/spanner-omni-kineviz-examples/blob/6bc61f017e0a0170f37edf51449ed76447df3ec7/demos/paysim-schemaless/kineviz/paysim-live.dashboard.json)
(MIT, Copyright 2026 Kineviz, Inc.). All ten database sources now use AGE
openCypher through Database Proxy. The 14 widgets include payment totals, value
and fraud-labelled value, daily activity, shared-identity transfer evidence,
recipient rankings, amount bands, merchant destinations, and canvas selection.

## Install into Kineviz Desktop

Start the example and its proxy from the repository root:

```bash
./gxr up paysim-schemaless
./gxr connect up paysim-schemaless
```

Create or open a **Database Proxy** project in Kineviz Desktop connected to
`http://127.0.0.1:9081/api/age/paysim-schemaless` (use your configured proxy port).
The API key is `PROXY_API_KEY` in your private `.env`.
Then run, from the repository root:

```bash
./demos/paysim-schemaless/scripts/install-dashboard.sh
```

The installer detects Desktop's saved port and the project connected to this
AGE endpoint. It saves the dashboard and registers it in the project's library,
following the original Spanner installer's Files API workflow. It does not create
or change a database connection. No `npm install` is needed; Node.js 22.18+ is enough.

In Desktop, open **Dashboard** in the left rail, then **PaySim · PostgreSQL + AGE**.
If the library was already open, switch to another panel and back. Opening the
dashboard starts its queries; no graph import or SQL mapping is required. The
canvas selection card reflects whatever nodes are currently selected.

For an explicit project/server, or machine-readable output:

```bash
./demos/paysim-schemaless/scripts/install-dashboard.sh PROJECT_ID --url http://127.0.0.1:80
./gxr dashboard install --json
```

`KINEVIZ_URL` is equivalent to `--url`. The project ID is the segment after `/p/`
in the project's URL. If multiple projects use this endpoint, the installer asks
for an explicit ID rather than choosing an unrelated active project. It requires
the local Desktop project API to be accessible; it does not bypass login on a
remote Kineviz server.

Alternatively, in **Dashboard → Import**, select `paysim-live.dashboard.json` from
this folder. The JSON contains no server address or credentials: database sources
use the current project's connection.

## Refresh and replay

KPIs, daily activity, and amount bands refresh every **2 seconds**; investigation
queries refresh every **10 seconds**. They query the entire connected graph,
independently of the nodes currently on the canvas.

The normal proxy registration points to **`paysim`**, the completed batch graph.
Its totals stay steady. `./gxr stream up` writes to the separate **`paysim_stream`**
graph and does not change that project connection. To watch a replay, separately
register `paysim_stream` in the AGE proxy and connect a Kineviz project to that
registration. Import the same dashboard JSON there, or use
`--proxy-project NAME` with the installer for that existing local registration.
See the [proxy registration API](../../../connect/README.md) and
[replay lifecycle](../../../streaming/README.md).
The installer neither starts nor clears a replay. A completed replay remains
complete; restarting it does not duplicate payments.

`isfraud` is planted synthetic ground truth, not a prediction. “Shared + transfers”
counts shared identifiers whose holders have a direct payment between them;
“shared only” means no such payment is present. These are investigation leads,
not determinations of fraud. Recipient totals count each originating account once,
so multiple shared identifiers do not inflate the payment value.

## Files and reinstall behavior

The installed spec is `/dashboards/paysim-age-live.dashboard.json` in the project's
Files, listed in `/dashboards/_index.json`. Other dashboards, favorites, rail pins,
and metadata are preserved. Reinstalling an edited version first saves the prior
spec and manifest under `/dashboards/backups/`. The installer reads both saved
files back to verify the installation. Close the dashboard editor while installing;
the Files API has no atomic transaction across the spec and index. Authentication
errors and malformed existing manifests stop installation rather than erase the
library.

If widgets report a query or connection error, run
`./gxr connect status paysim-schemaless` and check the project's API URL and key.
This file requires a Kineviz build supporting version 2.1 dashboards; the rendered
check used the local Desktop 0.19.0 development build documented in
[VALIDATION.md](../../../docs/VALIDATION.md).
