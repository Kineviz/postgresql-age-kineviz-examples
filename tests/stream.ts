import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {setTimeout} from "node:timers/promises";
import {compose, root, rows, run} from "../src/runtime.ts";
import {countsQuery, cypher} from "../src/age.ts";
import type {Dataset} from "../src/model.ts";

process.env.DEMO_TIME = "1";
process.env.REPLAY_LIMIT = "";
run("./gxr", ["stream", "up"], undefined, true);
const expected = JSON.parse(readFileSync(join(root, ".generated/paysim-schemaless/graph.json"), "utf8")) as Dataset;
const total = expected.vertices.filter(n => n.label === "transaction").length;
const deadline = Date.now() + 10 * 60 * 1000;
let landed = 0, completed = false;
while (Date.now() < deadline) {
  landed = Number(rows("SELECT count(*) AS n FROM public.replay_receipts")[0].n);
  const producerId = compose(["ps", "-a", "-q", "producer"], undefined, false, true).trim();
  const state = JSON.parse(run("docker", ["inspect", "--format", "{{json .State}}", producerId])) as {Status:string;ExitCode:number};
  if (state.Status === "exited") {
    assert.equal(state.ExitCode, 0, "producer failed");
    if (landed === total) {
      const status = compose(["exec", "-T", "broker", "/opt/kafka/bin/kafka-consumer-groups.sh", "--bootstrap-server", "broker:9092", "--describe", "--group", "paysim-age-sink"], undefined, false, true);
      const partitions = status.split("\n").map(line => line.trim().split(/\s+/)).filter(fields => fields[0] === "paysim-age-sink" && fields[1] === "paysim-transactions");
      if (partitions.length > 0 && partitions.every(fields => fields[5] === "0")) { completed = true; break; }
    }
  }
  await setTimeout(2000);
}
assert.ok(completed, `Replay incomplete: ${landed}/${total}`);
assert.deepEqual(rows(countsQuery("paysim_stream"))[0], {vertices:expected.vertices.length, edges:expected.edges.length});
const vertices = rows(cypher("paysim_stream", "MATCH (n) RETURN n._key, properties(n)", "key agtype, properties agtype"));
const edges = rows(cypher("paysim_stream", "MATCH (a)-[e]->(b) RETURN e._key, a._key, b._key, type(e), properties(e)", "key agtype, source agtype, target agtype, label agtype, properties agtype"));
const nodeMap = new Map(vertices.map(n => [n.key, n.properties]));
const edgeMap = new Map(edges.map(e => [e.key, e]));
for (const node of expected.vertices) assert.deepEqual(nodeMap.get(node.id), {...node.properties, _key:node.id}, node.id);
for (const edge of expected.edges) assert.deepEqual(edgeMap.get(edge.id), {key:edge.id, source:edge.source, target:edge.target, label:edge.label, properties:{...edge.properties,_key:edge.id}}, edge.id);
const progress = rows(readFileSync(join(root, "streaming/progress.sql"), "utf8"))[0];
assert.equal(progress.transactions, total);
console.log(`Kafka replay verified: ${total} transactions; every vertex, edge, endpoint, and property matches the batch fixture.`);
