import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import pg from "pg";
import {config, root, run} from "../src/runtime.ts";
import {connectCommand, connectionTarget, nativeUser, nativeSql} from "../src/connect.ts";
import {cypher} from "../src/age.ts";

for (const slug of ["fraud-rings", "edge-fleet", "paysim-schemaless", "paysim-stream"]) {
  await connectCommand("up", slug);
  const before = readFileSync(join(root, ".env"), "utf8");
  await connectCommand("up", slug);
  assert.equal(readFileSync(join(root, ".env"), "utf8"), before, "connect up must preserve credentials");
  const env = config(), graph = connectionTarget(slug).graph;
  if (slug === "fraud-rings") {
    const previous = process.env.KINEVIZ_NATIVE_PASSWORD;
    process.env.KINEVIZ_NATIVE_PASSWORD = "intentionally_wrong_native_password";
    try { assert.throws(() => nativeSql("SELECT 1;"), /password authentication failed/); }
    finally {
      if (previous === undefined) delete process.env.KINEVIZ_NATIVE_PASSWORD;
      else process.env.KINEVIZ_NATIVE_PASSWORD = previous;
    }
  }
  const reader = new pg.Client({host: "127.0.0.1", port: Number(env.AGE_PORT || 5455), database: "kineviz", user: nativeUser, password: env.KINEVIZ_NATIVE_PASSWORD});
  await reader.connect();
  try {
    // Native Desktop currently attempts LOAD even when AGE is preloaded. A
    // restricted login cannot LOAD arbitrary libraries; the server preloads it
    // and role search_path must still make the following connector probes work.
    await assert.rejects(reader.query("LOAD 'age'; SET search_path=ag_catalog,public;"), /not allowed/);
    const version = await reader.query("SELECT (SELECT extversion FROM pg_extension WHERE extname='age') AS age, 'agtype'::regtype::oid AS agtype_oid");
    assert.ok(version.rows[0].age && version.rows[0].agtype_oid);
    const roles = await reader.query("SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user");
    assert.deepEqual(roles.rows[0], {rolsuper:false, rolcreatedb:false, rolcreaterole:false});
    const labels = await reader.query("SELECT relation::text AS relation FROM ag_catalog.ag_label WHERE graph=(SELECT graphid FROM ag_catalog.ag_graph WHERE name=$1)", [graph]);
    assert.ok(labels.rows.length > 2);
    for (const {relation} of labels.rows) {
      await reader.query(`SELECT p.key, jsonb_typeof(p.value) FROM (SELECT properties FROM ${relation} LIMIT 10) s, LATERAL jsonb_each(s.properties::text::jsonb) AS p`);
    }
    const graphResult = await reader.query(cypher(graph, "MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 2", "n agtype, r agtype, m agtype"));
    assert.equal(graphResult.rows.length, 2);
    assert.match(graphResult.rows[0].n, /::vertex$/);
    assert.match(graphResult.rows[0].r, /::edge$/);
    const id = /"id":\s*(\d+)/.exec(graphResult.rows[0].n)![1];
    assert.equal((await reader.query(cypher(graph, `UNWIND [${id}] AS seed MATCH (n) WHERE id(n)=seed RETURN n LIMIT 1`))).rows.length, 1);
    if (slug !== "paysim-stream") {
      const path = join(root, "demos", slug, "queries/graph");
      for (const file of readdirSync(path)) {
        const query = readFileSync(join(path,file), "utf8");
        const columns = /RETURN ([^\n]+)/.exec(query)![1].split(",").map((_,i) => `v${i} agtype`).join(",");
        assert.ok((await reader.query(cypher(graph, query, columns))).rows.length, file);
      }
    }
    await assert.rejects(reader.query(`DELETE FROM "${graph}"._ag_label_vertex`), /read-only|permission denied/);
    await reader.query("SET default_transaction_read_only=off");
    await assert.rejects(reader.query(`DELETE FROM "${graph}"._ag_label_vertex`), /permission denied/);
    console.log(`Native TCP ${slug}: password, catalog/schema, graph/path queries, ID selection and restricted role verified.`);
  } finally { await reader.end(); }
}
// Legacy stop is explicitly separated; native commands must not launch a proxy.
const services = run("docker", ["compose", "--project-directory", root, "--env-file", join(root, ".env"), "-f", join(root, "compose.yaml"), "ps", "--services"]);
assert.ok(!services.split("\n").includes("proxy"));
