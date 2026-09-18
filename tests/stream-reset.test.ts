import assert from "node:assert/strict";
import {test} from "node:test";
import {resetReplayState, resetStreamCommand} from "../src/stream-reset.ts";
import type {ResetDatabase, ResetKafka} from "../src/stream-reset.ts";
import {proxyTarget} from "../src/connect.ts";

function fixture(options: {active?: boolean; kafkaFail?: boolean; wrongOffset?: boolean; sqlFail?: boolean; owned?: boolean} = {}) {
  const statements: string[] = [];
  let positioned = false;
  const db: ResetDatabase = {async query(sql) {
    statements.push(sql);
    if (sql.startsWith("SELECT graph")) return {rows: options.owned === false ? [] : [{graph: "paysim_stream"}]};
    if (sql.startsWith("TRUNCATE") && options.sqlFail) throw new Error("dependent table");
    if (sql.startsWith("SELECT\n")) return {rows: [{transactions: 0, receipts: 0, payment_edges: 0}]};
    return {rows: []};
  }};
  const kafka: ResetKafka = {
    async describeGroups() {return {groups: [{state: options.active ? "Stable" : "Empty", members: options.active ? [{}] : []}]};},
    async createTopics() {},
    async fetchTopicOffsets() {return [{partition: 0, offset: "7"}];},
    async setOffsets() {if (options.kafkaFail) throw new Error("Kafka unavailable"); positioned = true;},
    async fetchOffsets() {return [{topic: "paysim-transactions", partitions: [{partition: 0, offset: options.wrongOffset ? "0" : "7"}]}];},
  };
  return {db, kafka, statements, positioned: () => positioned};
}
test("reset requires explicit confirmation before lifecycle actions", () => {
  assert.throws(() => resetStreamCommand(), /--yes/);
  assert.throws(() => resetStreamCommand("yes"), /--yes/);
});
test("unowned graph or active consumer never changes offsets or clears payments", async () => {
  for (const options of [{owned: false}, {active: true}]) {
    const f = fixture(options); await assert.rejects(resetReplayState(f.db, f.kafka));
    assert.equal(f.positioned(), false); assert.ok(!f.statements.includes("BEGIN"));
  }
});
test("Kafka failure or unconfirmed offset never clears payments", async () => {
  for (const options of [{kafkaFail: true}, {wrongOffset: true}]) {
    const f = fixture(options); await assert.rejects(resetReplayState(f.db, f.kafka));
    assert.ok(!f.statements.some(s => s.startsWith("TRUNCATE")));
  }
});
test("SQL failure rolls back and successful reset commits only the replay tables", async () => {
  const failed = fixture({sqlFail: true}); await assert.rejects(resetReplayState(failed.db, failed.kafka), /dependent table/);
  assert.equal(failed.statements.at(-1), "ROLLBACK");
  const ok = fixture(); await resetReplayState(ok.db, ok.kafka); assert.equal(ok.statements.at(-1), "COMMIT");
  assert.ok(!ok.statements.some(s => /CASCADE|DROP|paysim\./.test(s)));
});
test("replay proxy target is separate from the preserved batch registration", () => {
  assert.equal(proxyTarget("paysim-stream").graph, "paysim_stream");
  assert.equal(proxyTarget("paysim-schemaless").graph, "paysim");
  assert.throws(() => proxyTarget("arbitrary-graph"));
});
