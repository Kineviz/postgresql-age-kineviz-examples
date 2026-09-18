import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {config, rows} from "../src/runtime.ts";
import {connectCommand, proxyBase, proxyRequest} from "../src/connect.ts";
import {demos} from "../src/model.ts";

type Graph = {nodes: {id: string; labels: string[]; properties: Record<string, unknown>}[];
  relationships: {id: string; startNodeId: string; endNodeId: string; type: string}[]};
type Response = {data: {type: string; data: Graph | unknown[][]}};
function graph(response: unknown): Graph {
  const result = response as Response;
  assert.equal(result.data.type, "GRAPH");
  const data = result.data.data as Graph;
  const ids = new Set(data.nodes.map(n => n.id));
  for (const edge of data.relationships) {
    assert.ok(ids.has(edge.startNodeId) && ids.has(edge.endNodeId), `Missing endpoints for ${edge.id}`);
    assert.match(edge.id, /^\d+$/);
  }
  for (const node of data.nodes) assert.match(node.id, /^\d+$/);
  return data;
}

for (const [slug, demo] of Object.entries(demos)) {
  await connectCommand("up", slug);
  const path = `/api/age/${slug}`;
  const query = (query: string, parameters: Record<string, unknown> = {}) => proxyRequest(`${path}/query`, {query, parameters});
  const schema = await proxyRequest(`${path}/graphSchema`) as {data: {categories: {name: string}[]; relationships: unknown[]}};
  const catalog = rows(`SELECT name FROM ag_catalog.ag_label WHERE kind='v' AND name <> '_ag_label_vertex' AND graph=(SELECT graphid FROM ag_catalog.ag_graph WHERE name='${demo.graph}') ORDER BY name`);
  assert.deepEqual(schema.data.categories.map(c => c.name), catalog.map(c => c.name));
  assert.ok(schema.data.relationships.length > 0);
  const caps = await proxyRequest(`${path}/capabilities`) as {type: string; intents: string[]};
  assert.equal(caps.type, "age");
  assert.deepEqual(caps.intents, ["expand", "pullCategory", "pullRelationship"]);
  const first = graph(await query("MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 20"));
  const edge = first.relationships[0];
  assert.ok(edge);
  assert.ok(graph(await query(`MATCH (n)-[r]-(m) WHERE id(n) IN ['${edge.startNodeId}'] AND id(m) IN ['${edge.endNodeId}'] RETURN n,r,m LIMIT 10`)).relationships.length > 0);
  // Equality with PostgreSQL's textual ID proves identities did not round in JSON.
  const exact = rows(`SELECT id::text AS id FROM "${demo.graph}"."${edge.type}" WHERE id::text='${edge.id}'`);
  assert.equal(exact[0].id, edge.id);
  graph(await query("MATCH (n)-[r]->(m) RETURN * LIMIT 3"));
  assert.equal(graph(await query("MATCH (n)-[r]->(m) RETURN r LIMIT 3")).relationships.length, 3);
  assert.ok(graph(await query("MATCH p=(n)-[r]->(m) RETURN p LIMIT 3")).nodes.length > 0);
  assert.ok(graph(await query("MATCH (n)-[r]->(m) WITH n,r,m LIMIT 3 RETURN {nodes:collect(n),edges:collect(r)} AS bundle")).relationships.length > 0);
  const table = await query("RETURN $text AS value, 2 * 3 AS product", {text: "quote' $text ::vertex"}) as Response;
  assert.deepEqual(table.data.data, [["value", "product"], ["quote' $text ::vertex", 6]]);
  const count = await query("MATCH (n) RETURN count(n) AS total") as Response;
  assert.equal(count.data.type, "TABLE");
  for (const file of readdirSync(`demos/${slug}/queries/graph`)) {
    const data = graph(await query(readFileSync(`demos/${slug}/queries/graph/${file}`, "utf8")));
    assert.ok(data.nodes.length > 0, `Empty example ${slug}/${file}`);
  }
  const category = first.nodes[0].labels[0];
  const pulled = graph(await proxyRequest(`${path}/pullCategory`, {category, limit: 3}));
  const more = graph(await proxyRequest(`${path}/pullCategory`, {category, loadedNodeIds: pulled.nodes.map(n => n.id), limit: 3}));
  assert.ok(more.nodes.every(n => !pulled.nodes.some(p => p.id === n.id)));
  const rels = graph(await proxyRequest(`${path}/pullRelationship`, {relationship: edge.type, limit: 3}));
  const moreRels = graph(await proxyRequest(`${path}/pullRelationship`, {relationship: edge.type, loadedRelationshipIds: rels.relationships.map(r => r.id), limit: 3}));
  assert.ok(moreRels.relationships.every(r => !rels.relationships.some(p => p.id === r.id)));
  for (const direction of ["all", "from", "to", "both"]) {
    const expanded = graph(await proxyRequest(`${path}/expand`, {nodeIds: [edge.startNodeId, edge.endNodeId], direction, limit: 20}));
    assert.ok(expanded.relationships.length > 0, `Empty ${direction} expansion`);
  }
  graph(await proxyRequest(`${path}/expand`, {nodeIds: [edge.startNodeId], hops: 2, limit: 10}));
  const hopsFiltered = graph(await proxyRequest(`${path}/expand`, {nodeIds: [edge.startNodeId], hops: 2, relationships: [edge.type], excludeRelationshipIds: [edge.id], limit: 10}));
  assert.ok(hopsFiltered.relationships.every(r => r.type === edge.type && r.id !== edge.id));
  const internal = graph(await proxyRequest(`${path}/expand`, {nodeIds: [edge.startNodeId, edge.endNodeId], onlyBetweenSelected: true, limit: 50}));
  assert.ok(internal.relationships.every(r => [edge.startNodeId, edge.endNodeId].includes(r.startNodeId) && [edge.startNodeId, edge.endNodeId].includes(r.endNodeId)));
  const filtered = graph(await proxyRequest(`${path}/expand`, {nodeIds: [edge.startNodeId], relationships: [edge.type], excludeRelationshipIds: [edge.id], limit: 20}));
  assert.ok(filtered.relationships.every(r => r.type === edge.type && r.id !== edge.id));
  const hidden = graph(await proxyRequest(`${path}/expand`, {nodeIds: [edge.startNodeId], excludeRelationshipTypes: [edge.type], limit: 20}));
  assert.ok(hidden.relationships.every(r => r.type !== edge.type));
  await assert.rejects(query("MATCH (n) RETURN missing"));
  await assert.rejects(query(`MATCH (n:\`${category}\`) SET n.proxy_must_not_write=true RETURN n LIMIT 1`), /read-only|permission denied/);
  await assert.rejects(query("RETURN 1; SELECT pg_sleep(1)"), /one Cypher/);
  assert.equal((await fetch(`${proxyBase()}${path}/graphSchema`)).status, 401);
  console.log(`Proxy integration passed: ${slug}; schema, graph/table/path/list mapping, exact IDs, pulls, expansion, filters and write denial.`);
}
// Read access must not expose project configuration or permit reconfiguration.
assert.equal((await fetch(`${proxyBase()}/api/project/list`, {headers: {"X-API-Key": config().PROXY_API_KEY}})).status, 401);
const cors = await fetch(`${proxyBase()}/api/age/paysim-schemaless/query`, {method:"OPTIONS", headers:{Origin:"http://localhost:9000", "Access-Control-Request-Method":"POST", "Access-Control-Request-Headers":"content-type,x-api-key", "Access-Control-Request-Private-Network":"true"}});
assert.equal(cors.status, 200);
assert.equal(cors.headers.get("access-control-allow-private-network"), "true");
for (let i=0; i<20; i++) await proxyRequest("/api/age/paysim-schemaless/query", {query:"MATCH (n) RETURN n LIMIT 1"});
assert.equal(rows("SELECT count(*) AS n FROM pg_stat_activity WHERE application_name='kineviz-age-proxy'")[0].n, 0, "Connections must close after requests");
console.log("Proxy authentication, browser preflight and connection cleanup passed.");

// The live dashboard has a dedicated registration; creating it must not repoint batch.
await connectCommand("up", "paysim-stream");
for (const [project, schema] of [["paysim-stream", "paysim_stream"], ["paysim-schemaless", "paysim"]]) {
  const result = await proxyRequest(`/api/age/${project}/query`, {query: "MATCH (t:transaction) RETURN count(*) AS n"}) as Response;
  assert.deepEqual(result.data.data, [["n"], [rows(`SELECT count(*) AS n FROM ${schema}.transaction`)[0].n]]);
}
console.log("Separate batch and replay proxy registrations verified.");
