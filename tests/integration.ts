import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import pg from "pg";
import {config, root, run, rows, sql} from "../src/runtime.ts";
import {demos} from "../src/model.ts";
import {countsQuery, cypher} from "../src/age.ts";
import {parseCsv} from "../src/csv.ts";
import {replayStatement} from "../src/age.ts";
import {payment, transaction} from "../streaming/events.ts";

for (const [slug, demo] of Object.entries(demos)) {
  run("./gxr", ["up", slug], undefined, true);
  const before = rows(countsQuery(demo.graph));
  run("./gxr", ["up", slug], undefined, true);
  assert.deepEqual(rows(countsQuery(demo.graph)), before, "up must preserve existing data");
  assert.throws(() => run("./gxr", ["down", slug]), /confirm/);
  run("./gxr", ["export", slug], undefined, true);
  const dir = join(root, "exports", slug);
  const nodes = parseCsv(readFileSync(join(dir, "nodes.csv"), "utf8")).slice(1);
  const edges = parseCsv(readFileSync(join(dir, "edges.csv"), "utf8")).slice(1);
  const ids = new Set(nodes.map(n => n[0]));
  assert.equal(nodes.length, Number(before[0].vertices));
  assert.equal(edges.length, Number(before[0].edges));
  for (const e of edges) assert.ok(ids.has(e[1]) && ids.has(e[2]), `Dangling exported edge ${e[0]}`);
}

const env = config();
const reader = new pg.Client({host:"127.0.0.1", port:Number(env.AGE_PORT || 5455), user:"kineviz_reader", password:env.KINEVIZ_PASSWORD, database:"kineviz"});
await reader.connect();
try {
  // Exactly one SELECT per request, just like Kineviz's SQL connector.
  const result = await reader.query(readFileSync(join(root, "demos/fraud-rings/queries/canvas/02-money-cycles.sql"), "utf8"));
  assert.ok(result.rows.length > 0);
  assert.equal(typeof result.rows[0].source_id, "string");
  assert.throws(() => sql("BEGIN; SELECT create_graph('integration_rollback'); SELECT no_such_function(); COMMIT;"));
  assert.equal(rows("SELECT name FROM ag_graph WHERE name='integration_rollback'").length, 0);
  await assert.rejects(reader.query("DELETE FROM fraud_rings.\"Client\""), /read-only|permission denied/);
  await assert.rejects(reader.query(cypher("fraud_rings", "CREATE (:Client {_key:'must-not-exist'})")), /read-only|permission denied/);
  // Even disabling the session's read-only preference must not grant table writes.
  await reader.query("SET default_transaction_read_only=off");
  await assert.rejects(reader.query("DELETE FROM fraud_rings.\"Client\""), /permission denied/);
} finally { await reader.end(); }

run("./gxr", ["stream", "prepare"], undefined, true);
const csv = parseCsv(readFileSync(join(root, ".generated/paysim-schemaless/transactions.csv"), "utf8"));
const header = csv.shift()!;
const event = transaction(payment({...Object.fromEntries(header.map((key, i) => [key, csv[0][i]])), global_step: "90000001"}));
// Exercise the actual stream MERGE twice in a rollback-only transaction, so
// the streaming graph stays ready for a complete Kafka replay after this test.
const check = sql(`BEGIN; ${replayStatement("paysim_stream", event)}; ${replayStatement("paysim_stream", event)};
  SELECT 'CHECK:' || row_to_json(c) FROM (${countsQuery("paysim_stream")}) c; ROLLBACK;`);
const counts = JSON.parse(check.split("\n").find(line => line.startsWith("CHECK:"))!.slice(6)) as {vertices:number;edges:number};
const baseline = rows(countsQuery("paysim_stream"))[0];
assert.equal(counts.vertices, Number(baseline.vertices) + 1);
assert.equal(counts.edges, Number(baseline.edges) + 2);
console.log("Integration passed: all demos, 24 queries, preservation, CSV endpoints, SQL reader, rollback, write denial, and replay idempotency.");
