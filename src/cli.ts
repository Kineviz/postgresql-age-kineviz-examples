import {existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync} from "node:fs";
import {join, resolve} from "node:path";
import {demos, demoName} from "./model.ts";
import type {Dataset, Demo} from "./model.ts";
import {actorsOnly, readDataset} from "./data.ts";
import {countsQuery, cypher, identifier, loadStatements, sqlString} from "./age.ts";
import {config, compose, generated, root, rows, run, sql, start} from "./runtime.ts";
import {csvRows} from "./csv.ts";
import {connectCommand} from "./connect.ts";
import {dashboardCommand} from "./dashboard.ts";
import {resetStreamCommand} from "./stream-reset.ts";

function dataFor(demo: Demo): Dataset {
  const dir = generated(demo);
  run("python3", [join(root, "vendor/generators", `${demo}.py`), "--out", dir]);
  const data = readDataset(demo, dir);
  writeFileSync(join(dir, "graph.json"), JSON.stringify(data));
  return data;
}
function exists(graph: string): boolean { return rows(`SELECT name FROM ag_catalog.ag_graph WHERE name=${sqlString(graph)}`).length > 0; }
function owned(graph: string): void {
  if (!rows(`SELECT graph FROM public.demo_registry WHERE graph=${sqlString(graph)}`).length) throw new Error(`Refusing to change unowned graph ${graph}`);
}
function load(demo: Demo, graph: string, data: Dataset): void {
  if (exists(graph)) { owned(graph); console.log(`${graph} already exists; preserving it.`); return; }
  console.log(`Loading ${graph}: ${data.vertices.length} vertices, ${data.edges.length} edges…`);
  // All graph DDL and data commit together. A failed setup never leaves a half graph.
  sql(["BEGIN", ...loadStatements(graph, data),
    `GRANT USAGE ON SCHEMA "${graph}" TO kineviz_reader`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA "${graph}" TO kineviz_reader`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA "${graph}" GRANT SELECT ON TABLES TO kineviz_reader`,
    `INSERT INTO public.demo_registry VALUES (${sqlString(graph)}, ${sqlString(demo)}, ${data.vertices.length}, ${data.edges.length})`, "COMMIT"].join(";\n") + ";");
}
function scalar(graph: string, query: string): unknown[] {
  return rows(`SELECT value::text AS value FROM (${cypher(graph, query)}) result`).map(r => r.value);
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`Verification failed: ${message}`); }
function queryFiles(demo: Demo, canvas = false): string[] {
  const dir = join(root, "demos", demo, "queries", ...(canvas ? ["canvas"] : []));
  return readdirSync(dir).filter(f => f.endsWith(".sql")).sort().map(f => join(dir, f));
}
function verify(demo: Demo): void {
  const graph = demos[demo].graph;
  owned(graph);
  const expected = rows(`SELECT vertices, edges FROM public.demo_registry WHERE graph=${sqlString(graph)}`)[0];
  const actual = rows(countsQuery(graph))[0];
  assert(actual.vertices === expected.vertices && actual.edges === expected.edges, `counts ${JSON.stringify(actual)} differ from seed ${JSON.stringify(expected)}`);
  for (const file of [...queryFiles(demo), ...queryFiles(demo, true)]) {
    const result = rows(readFileSync(file, "utf8"));
    assert(result.length > 0, `query returned no rows: ${file}`);
  }
  if (demo === "fraud-rings") {
    const shared = scalar(graph, "MATCH (c:Client)-[:USED_DEVICE]->(d:Device) WITH d, count(DISTINCT c) AS n WHERE n > 1 RETURN d.id");
    const rings = scalar(graph, "MATCH (a:Client)-[:USED_DEVICE]->(d:Device)<-[:USED_DEVICE]-(b:Client), (a)-[:PAID]->(b) WHERE a.id <> b.id RETURN DISTINCT d.id");
    assert(shared.length === 3 && rings.length === 2 && !rings.includes("D0302"), "expected two ring devices and one innocent family");
  } else if (demo === "edge-fleet") {
    const top = scalar(graph, "MATCH (d:Device)-[:CONNECTED_TO]->(g:Gateway) WITH g, count(d) AS n RETURN n ORDER BY n DESC LIMIT 2").map(Number);
    assert(top[0] > 2 * top[1], "gateway concentration is missing");
    const tails = scalar(graph, "MATCH (d:Device)-[:DEPENDS_ON*1..4]->(root:Device) WITH root, count(DISTINCT d) AS n WHERE n >= 3 RETURN root.id");
    assert(tails.length > 0, "dependency cascade is missing");
  } else {
    const planted = JSON.parse(readFileSync(join(generated(demo), "PLANTED.json"), "utf8")) as {family: {members: string[]}};
    const family = planted.family.members.map(id => `client_${id}`);
    const rings = scalar(graph, "MATCH (a:client)-[left_identity]->(i)<-[right_identity]-(b:client), (a)-[:performs]->(:transaction)-[:to_client]->(b) WHERE type(left_identity) IN ['has_ssn', 'has_email', 'has_phone'] AND type(right_identity) IN ['has_ssn', 'has_email', 'has_phone'] AND a._key <> b._key RETURN DISTINCT a._key");
    assert(rings.length >= 4 && family.every(id => !rings.includes(id)), "ring evidence or innocent family separation is missing");
    assert(scalar(graph, "MATCH (n) RETURN DISTINCT label(n)").length === 7, "expected seven AGE vertex labels");
  }
  console.log(`Verified ${demo}: ${actual.vertices} vertices, ${actual.edges} edges; all analytical and canvas queries passed.`);
}
function connect(demo: Demo): void {
  const env = config();
  console.log(`For a live graph connection: ./gxr connect up ${demo}\nChoose Database Proxy in Kineviz and use the URL that command prints.\nOptional SQL panel server: 127.0.0.1:${env.AGE_PORT || "5455"}; database kineviz; user kineviz_reader.\nSQL password: KINEVIZ_PASSWORD in .env. See connect/README.md.`);
}
function exportGraph(demo: Demo): void {
  const graph = demos[demo].graph, dir = join(root, "exports", demo);
  mkdirSync(dir, {recursive: true});
  const nodes = rows(cypher(graph, "MATCH (n) RETURN n._key, label(n), properties(n)", "key agtype, label agtype, properties agtype"));
  const edges = rows(cypher(graph, "MATCH (a)-[e]->(b) RETURN e._key, a._key, b._key, type(e), properties(e)", "key agtype, source agtype, target agtype, label agtype, properties agtype"));
  const decode = (value: unknown): unknown => value;
  writeFileSync(join(dir, "nodes.csv"), csvRows([["id", "category", "properties"], ...nodes.map(n => [decode(n.key), decode(n.label), decode(n.properties)])]));
  writeFileSync(join(dir, "edges.csv"), csvRows([["id", "source", "target", "relationship", "properties"], ...edges.map(e => [decode(e.key), decode(e.source), decode(e.target), decode(e.label), decode(e.properties)])]));
  // Per-label files expose properties as ordinary columns for Mapping Editor.
  for (const label of new Set(nodes.map(n => String(decode(n.label))))) {
    const selected = nodes.filter(n => decode(n.label) === label).map(n => ({...((decode(n.properties) as Record<string, unknown>)), original_id: (decode(n.properties) as Record<string, unknown>).id, id: decode(n.key)}));
    const keys = [...new Set(selected.flatMap(n => Object.keys(n)))];
    writeFileSync(join(dir, `nodes-${identifier(label)}.csv`), csvRows([keys, ...selected.map(n => keys.map(k => (n as Record<string, unknown>)[k]))]));
  }
  for (const file of queryFiles(demo, true)) {
    const result = rows(readFileSync(file, "utf8"));
    const keys = Object.keys(result[0] || {});
    writeFileSync(join(dir, file.split("/").at(-1)!.replace(/\.sql$/, ".csv")), csvRows([keys, ...result.map(r => keys.map(k => r[k]))]));
  }
  console.log(`Exported ${nodes.length} nodes and ${edges.length} edges to ${dir}`);
}
function stream(action: string | undefined): void {
  if (action === "prepare") {
    start();
    const data = actorsOnly(dataFor("paysim-schemaless"));
    load("paysim-schemaless", "paysim_stream", data);
    sql(`CREATE TABLE IF NOT EXISTS public.replay_receipts(event_id text PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now());`);
    // Empty labels are needed before a live dashboard runs its first query.
    for (const [label, kind] of [["transaction", "v"], ["performs", "e"], ["to_client", "e"], ["to_merchant", "e"], ["to_bank", "e"]]) {
      const found = rows(`SELECT name FROM ag_catalog.ag_label WHERE name=${sqlString(label)} AND graph=(SELECT graphid FROM ag_catalog.ag_graph WHERE name='paysim_stream')`);
      if (!found.length) sql(`SELECT ag_catalog.create_${kind}label('paysim_stream', ${sqlString(label)});`);
    }
    sql('GRANT SELECT ON ALL TABLES IN SCHEMA paysim_stream TO kineviz_reader; CREATE INDEX IF NOT EXISTS transaction_properties ON paysim_stream.transaction USING gin(properties);');
    console.log("Replay graph ready: paysim_stream. The batch graph paysim is preserved.");
  } else if (action === "up") {
    stream("prepare");
    compose(["up", "-d", "--build", "broker", "sink", "producer"], undefined, true, true);
  } else if (action === "status") {
    console.log(compose(["ps", "-a"], undefined, false, true));
    console.log(JSON.stringify(rows(`SELECT (SELECT count(*) FROM public.replay_receipts) AS landed_transactions, (SELECT count(*) FROM paysim_stream.transaction) AS transaction_vertices`), null, 2));
    console.log(compose(["logs", "--tail", "3", "producer", "sink"], undefined, false, true));
    console.log(compose(["exec", "-T", "broker", "/opt/kafka/bin/kafka-consumer-groups.sh", "--bootstrap-server", "broker:9092", "--describe", "--group", "paysim-age-sink"], undefined, false, true));
  } else if (action === "down") compose(["stop", "producer", "sink", "broker"], undefined, true, true);
  else throw new Error("Use ./gxr stream prepare|up|status|down|reset --yes");
}
async function main(): Promise<void> {
  const [command, arg, extra] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    console.log("gxr list | up <demo> | verify <demo> | query <demo> <file.sql> | export <demo>\n    connect up <demo|paysim-stream> | connect status [demo|paysim-stream] | connect down\n    dashboard install [projectId] [--url http://host:port]\n    generate <demo> | down <demo> --yes | db start|status|stop | stream prepare|up|status|down|reset --yes"); return;
  }
  if (command === "list") { for (const [slug, demo] of Object.entries(demos)) console.log(`${slug}: ${demo.title}`); return; }
  if (command === "db") {
    if (arg === "start") start();
    else if (arg === "status") console.log(compose(["ps"]));
    else if (arg === "stop") compose(["stop", "db"], undefined, true);
    else throw new Error("Use ./gxr db start|status|stop");
    return;
  }
  if (command === "dashboard") {
    if (arg !== "install") throw new Error("Use ./gxr dashboard install [projectId] [--url http://host:port]");
    await dashboardCommand(process.argv.slice(4)); return;
  }
  if (command === "stream") {
    if (arg === "reset") resetStreamCommand(extra); else stream(arg);
    return;
  }
  if (command === "connect" && ["up", "status", "down"].includes(arg)) { await connectCommand(arg, extra); return; }
  const demo = demoName(arg), graph = demos[demo].graph;
  if (command === "generate") { const data = dataFor(demo); console.log(`${data.vertices.length} vertices, ${data.edges.length} edges → .generated/${demo}/graph.json`); }
  else if (command === "up") { start(); load(demo, graph, dataFor(demo)); verify(demo); connect(demo); }
  else if (command === "verify") verify(demo);
  else if (command === "connect") connect(demo);
  else if (command === "export") exportGraph(demo);
  else if (command === "query") {
    if (!extra || !existsSync(resolve(root, extra))) throw new Error("Provide an existing SQL file");
    console.log(JSON.stringify(rows(readFileSync(resolve(root, extra), "utf8")), null, 2));
  } else if (command === "down") {
    if (extra !== "--yes") throw new Error(`Drops only ${graph}. To confirm: ./gxr down ${demo} --yes`);
    owned(graph);
    sql(`BEGIN; SELECT ag_catalog.drop_graph(${sqlString(graph)}, true); DELETE FROM public.demo_registry WHERE graph=${sqlString(graph)}; COMMIT;`);
    console.log(`Dropped ${graph}; deployment and other graphs preserved.`);
  } else throw new Error(`Unknown command: ${command}`);
}
try { await main(); } catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}\nREMEDIATION: See docs/TROUBLESHOOTING.md; do not remove the database volume.`);
  process.exitCode = 1;
}
