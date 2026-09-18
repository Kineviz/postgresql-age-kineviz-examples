import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {csvRows, parseCsv} from "../src/csv.ts";
import {cypher, literal, identifier} from "../src/age.ts";
import {readDataset, actorsOnly} from "../src/data.ts";
import {demoName, validateDataset} from "../src/model.ts";
import {payment, transaction} from "../streaming/events.ts";

test("CSV round trip preserves quoted JSON, Unicode, CRLF, commas and newlines", () => {
  const rows = [["name", "json"], ["Ana, O'Neil\nSão Paulo", '{"phone":"+1-123"}'], ["", '"quoted"']];
  assert.deepEqual(parseCsv(csvRows(rows).replaceAll("\n", "\r\n")).map(r => r.map(v => v.replaceAll("\r\n", "\n"))), rows);
  assert.throws(() => parseCsv('"broken'), /Unterminated/);
});
test("SQL delimiter collision and identifiers cannot escape their context", () => {
  const payload = "O'Neil $age$; DROP SCHEMA public; --\n\\\"";
  const result = cypher("demo", `RETURN ${literal(payload)}`);
  assert.ok(result.includes("$agex$"));
  assert.equal(result.split("$agex$").length, 3);
  assert.throws(() => identifier('graph; DROP TABLE x'), /Invalid/);
  assert.throws(() => literal(NaN), /Unsupported/);
  assert.throws(() => demoName("../../production"), /Choose a demo/);
});
test("dangling endpoints and duplicate keys fail before database writes", () => {
  assert.throws(() => validateDataset({vertices: [], edges: [{id:"e", label:"TO", source:"x", target:"y", properties:{}}]}), /Missing endpoint/);
  const node = {id:"x", label:"Person", properties:{}};
  assert.throws(() => validateDataset({vertices:[node,node], edges:[]}), /Duplicate vertex/);
});
test("PaySim event replay exactly matches batch identities, types, and properties", () => {
  const out = mkdtempSync(join(tmpdir(), "age-fixture-"));
  execFileSync("python3", ["vendor/generators/paysim-schemaless.py", "--out", out, "--clients", "40", "--transactions", "500"]);
  const data = readDataset("paysim-schemaless", out);
  const records = parseCsv(readFileSync(join(out, "transactions.csv"), "utf8"));
  const header = records.shift()!;
  for (const row of records) {
    const event = transaction(payment(Object.fromEntries(header.map((key, i) => [key, row[i]]))));
    const batch = data.vertices.find(n => n.id === event.id);
    assert.ok(batch, event.id);
    assert.deepEqual(batch.properties, event.properties);
    assert.ok(data.edges.some(e => e.source === event.source && e.target === event.id && e.label === "performs"));
    assert.ok(data.edges.some(e => e.source === event.id && e.target === event.target && e.label === event.relationship));
  }
  const actors = actorsOnly(data);
  validateDataset(actors);
  assert.ok(actors.vertices.every(n => n.label !== "transaction"));
  assert.equal(actors.edges.length, 120);
  const first = Object.fromEntries(header.map((key, i) => [key, records[0][i]]));
  assert.throws(() => payment({...first, amount:"NaN"}), /amount/);
  assert.throws(() => payment({...first, global_step:"-1"}), /global_step/);
  assert.throws(() => payment({...first, is_fraud:"yes"}), /fraud flag/);
});
