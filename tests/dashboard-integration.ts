import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {proxyRequest} from "../src/connect.ts";
import {generated, sql} from "../src/runtime.ts";
import {specFile} from "../src/dashboard.ts";
import type {Dataset} from "../src/model.ts";
import {actorsOnly} from "../src/data.ts";
import {cypher, loadStatements} from "../src/age.ts";

const spec = JSON.parse(readFileSync(specFile, "utf8")) as {sources: {id: string; kind: string; query: string}[]};
const data = JSON.parse(readFileSync(join(generated("paysim-schemaless"), "graph.json"), "utf8")) as Dataset;
const nodes = new Map(data.vertices.map(n => [n.id, n]));
const payments = data.vertices.filter(n => n.label === "transaction");
const cents = (n: {properties: Record<string, unknown>}) => Math.round(Number(n.properties.amount) * 100);
const total = payments.reduce((n, t) => n + cents(t), 0);
const fraud = payments.filter(t => t.properties.isfraud === true);
const flagged = fraud.reduce((n, t) => n + cents(t), 0);
const origin = new Map(data.edges.filter(e => e.label === "performs").map(e => [e.target, e.source]));
const clientDest = new Map(data.edges.filter(e => e.label === "to_client").map(e => [e.source, e.target]));
const merchantDest = new Map(data.edges.filter(e => e.label === "to_merchant").map(e => [e.source, e.target]));
const holders = new Map<string, Set<string>>();
for (const e of data.edges.filter(e => ["has_ssn", "has_email", "has_phone"].includes(e.label))) {
  if (!holders.has(e.target)) holders.set(e.target, new Set());
  holders.get(e.target)!.add(e.source);
}
const shared = [...holders.values()].filter(h => h.size > 1);
const sharingClients = new Set(shared.flatMap(h => [...h]));
const counts = {"shared + transfers": 0, "shared only": 0};
for (const h of shared) {
  const transfers = payments.some(t => h.has(origin.get(t.id)!) && h.has(clientDest.get(t.id)!) && origin.get(t.id) !== clientDest.get(t.id));
  counts[transfers ? "shared + transfers" : "shared only"]++;
}
const sums = (items: typeof payments, key: (t: typeof payments[number]) => string) => {
  const map = new Map<string, number>();
  for (const t of items) { const k = key(t); map.set(k, (map.get(k) || 0) + cents(t)); }
  return [...map].map(([k, v]) => [k, v / 100] as [string, number]);
};
const ranked = (items: [string, number][], limit: number) => items.sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
const daily = sums(payments, t => `${String(t.properties.timestamp).slice(0, 10)}|${t.properties.isfraud ? "fraud" : "legitimate"}`).map(([k, v]) => [...k.split("|"), v]);
const bands = new Map<number, {n: number; flagged: number}>();
for (const t of payments) {
  const amount = Number(t.properties.amount);
  const d = [10,100,1000,10000,100000].findIndex(x => amount < x);
  const decade = d < 0 ? 5 : d;
  const b = bands.get(decade) || {n: 0, flagged: 0}; b.n++; if(t.properties.isfraud) b.flagged++; bands.set(decade, b);
}
const expected: Record<string, unknown[][]> = {
  landed: [[payments.length]], totals: [[Math.round(total / 1_000_000) / 100]],
  risk: [[Math.round(flagged / 100), Math.round(10000 * flagged / total) / 100, Math.round(Math.max(...fraud.map(cents)) / 100)]],
  daily,
  bands: [...bands].map(([d, b]) => [d, ["under $10", "$10–99", "$100–999", "$1k–10k", "$10k–100k", "$100k+"][d], Math.round(1000 * b.flagged / b.n) / 10]),
  verdict: Object.entries(counts).filter(([,n]) => n > 0),
  suspects: ranked(sums(fraud, t => String(nodes.get(origin.get(t.id)!)!.properties.name)), 8).map(([name, amount]) => [name, fraud.filter(t => nodes.get(origin.get(t.id)!)!.properties.name === name).length, amount]),
  ringFanIn: ranked(sums(payments.filter(t => sharingClients.has(origin.get(t.id)!) && clientDest.has(t.id)), t => String(nodes.get(clientDest.get(t.id)!)!.properties.name)), 8),
  mules: ranked(sums(payments.filter(t => nodes.get(clientDest.get(t.id)!)?.properties.client_type === "MULE"), t => String(nodes.get(clientDest.get(t.id)!)!.properties.name)), 10),
  exitRisk: sums(payments.filter(t => merchantDest.has(t.id)), t => nodes.get(merchantDest.get(t.id)!)!.properties.highrisk ? "high-risk merchants" : "normal merchants").map(([k,v]) => [k, "merchant cash-out", v]),
};
const headers: Record<string, string[]> = {landed:["landed"], totals:["volume_m"], risk:["at_risk","pct_value","biggest"], daily:["day","kind","volume"], bands:["decade","band","percent_fraud"], verdict:["verdict","identities"], suspects:["suspect","txns","moved"], ringFanIn:["collector","received"], mules:["mule","taken"], exitRisk:["destination","channel","volume"]};
const stable = (values: unknown[][]) => values.map(v => JSON.stringify(v)).sort();
for (const source of spec.sources.filter(s => s.kind === "db")) {
  const result = await proxyRequest("/api/age/paysim-schemaless/query", {query: source.query}) as {data: {type: string; data: unknown[][]}};
  assert.equal(result.data.type, "TABLE", source.id);
  assert.deepEqual(result.data.data[0], headers[source.id], `${source.id} headers`);
  assert.deepEqual(stable(result.data.data.slice(1)), stable(expected[source.id]), `${source.id} fixture values`);
  console.log(`Dashboard ${source.id}: fixture totals and table headers verified.`);
}
// A replay starts with identities and no payments. Exercise that state without
// clearing either real graph: all temporary label/data creation rolls back.
const tempGraph = `dashboard_check_${randomUUID().replaceAll("-", "")}`;
const statements = ["BEGIN", ...loadStatements(tempGraph, actorsOnly(data)),
  `SELECT ag_catalog.create_vlabel('${tempGraph}', 'transaction')`,
  ...["performs", "to_client", "to_merchant", "to_bank"].map(l => `SELECT ag_catalog.create_elabel('${tempGraph}', '${l}')`)];
for (const source of spec.sources.filter(s => s.kind === "db")) {
  const cols = headers[source.id].map(h => `"${h}" agtype`).join(", ");
  const jsonColumns = headers[source.id].map(h => `"${h}"::text AS "${h}"`).join(", ");
  statements.push(`SELECT json_build_object('source', '${source.id}', 'rows', coalesce(json_agg(row_to_json(q)), '[]'::json)) FROM (SELECT ${jsonColumns} FROM (${cypher(tempGraph, source.query, cols)}) values_row) q`);
}
statements.push("ROLLBACK");
const empty = sql(statements.join(";\n") + ";").split("\n").filter(line => line.startsWith('{"source"')).map(line => JSON.parse(line) as {source: string; rows: Record<string, unknown>[]});
assert.equal(empty.length, 10);
for (const r of empty) {
  r.rows = r.rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" && /^-?[0-9]+(\.[0-9]+)?$/.test(v) ? Number(v) : v])));
  if (r.source === "landed") assert.deepEqual(r.rows, [{landed: 0}]);
  else if (r.source === "totals") assert.deepEqual(r.rows, [{volume_m: 0}]);
  else if (r.source === "risk") assert.deepEqual(r.rows, [{at_risk: 0, pct_value: 0, biggest: 0}]);
  else if (r.source === "verdict") assert.deepEqual(r.rows, [{verdict: "shared only", identities: shared.length}]);
  else assert.deepEqual(r.rows, [], r.source);
}
console.log("All dashboard queries also passed with zero payments; temporary graph rolled back.");
