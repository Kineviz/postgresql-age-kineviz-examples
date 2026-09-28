import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {chooseProject, findDesktop, installDashboard, mergeManifest, normalizeServerUrl, parseManifest, projectsAt, specFile} from "../src/dashboard.ts";
import type {DashboardSpec} from "../src/dashboard.ts";

const spec = JSON.parse(readFileSync(specFile, "utf8")) as DashboardSpec;
const target = {host: "127.0.0.1", port: 5455, database: "kineviz", graph: "paysim_stream"};
const project = {_id: "age", projectName: "AGE", hostname: "127.0.0.1", databaseType: "apacheAge", boltPort: "5455", currentNeo4jDB: "kineviz", graphName: "paysim_stream"};

test("installer matches native host, port, database and graph, never a proxy or batch project", () => {
  assert.equal(chooseProject([{...project, hostname: "localhost"}], target)._id, "age");
  assert.equal(chooseProject([{...project, currentDB: "neo4j"}], target)._id, "age");
  for (const patch of [{databaseType: "databaseProxy"}, {databaseType: "postgresGraph"}, {boltPort: "5432"},
    {currentNeo4jDB: "other"}, {graphName: "paysim"}, {hostname: "remote"}, {graphName: ""}]) {
    assert.throws(() => chooseProject([{...project, ...patch}], target), /No project/);
  }
  assert.throws(() => chooseProject([project], target, "unrelated"), /not connected/);
  assert.throws(() => chooseProject([project, {...project, _id: "other"}], target), /Several projects/);
  assert.equal(chooseProject([project, {...project, _id: "other"}], target, "other")._id, "other");
});
test("manifest merge preserves unrelated dashboards, metadata, and explicit false pin values", () => {
  const original = {format: "custom", dashboards: [{id: "unrelated", title: "Keep me"}, {id: spec.id, fav: false, menubar: "", menubarSide: "right", railIcon: "custom", customField: 3}]};
  const merged = mergeManifest(original, spec, 123);
  assert.deepEqual(merged.dashboards[0], original.dashboards[0]);
  assert.equal(merged.format, "custom");
  assert.equal(merged.dashboards[1].fav, false);
  assert.equal(merged.dashboards[1].menubar, "");
  assert.equal(merged.dashboards[1].menubarSide, "right");
  assert.equal(merged.dashboards[1].customField, 3);
  assert.equal(mergeManifest(merged, spec, 124).dashboards.length, 2);
  assert.throws(() => parseManifest("{}"), /invalid/);
  assert.throws(() => parseManifest('{"dashboards": {}}'), /invalid/);
  assert.throws(() => parseManifest("<html>login</html>"));
});

async function mockFiles(initial: Record<string, string>, status = 200, requiredKey?: string) {
  const files = new Map(Object.entries(initial));
  let writes = 0;
  let authorizedRequests = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (requiredKey && req.headers["x-api-key"] !== requiredKey) {
      res.writeHead(200, {"Content-Type": "application/json"}).end(JSON.stringify({status: 401, message: "Please login at first"})); return;
    }
    authorizedRequests++;
    if (url.pathname === "/api/graph/neo4j/project/list") {
      res.writeHead(200, {"Content-Type": "application/json"}).end(JSON.stringify({status: 0, content: [project]})); return;
    }
    const endpoint = url.pathname.split("/").at(-1);
    if (endpoint === "download") {
      if (status !== 200) { res.writeHead(status).end(); return; }
      const content = files.get(url.searchParams.get("path")!.replace(/^\//, ""));
      res.writeHead(content === undefined ? 404 : 200).end(content); return;
    }
    writes++;
    let body = ""; for await (const chunk of req) body += chunk;
    const value = JSON.parse(body) as {path: string; content: string};
    if (endpoint === "mkdir") { res.writeHead(200).end("{}"); return; }
    if (endpoint === "write" && !files.has(value.path)) { res.writeHead(404).end(); return; }
    files.set(value.path, value.content); res.writeHead(200).end("{}");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return {files, url: `http://127.0.0.1:${address.port}`, writes: () => writes, authorizedRequests: () => authorizedRequests, close: async () => {server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));}};
}
test("install creates files, verifies readback, preserves library and backs up an edited prior version", async () => {
  const old = '{"title":"user edits"}';
  const path = `dashboards/${spec.id}.dashboard.json`;
  const mock = await mockFiles({[path]: old, "dashboards/_index.json": JSON.stringify({dashboards: [{id: "other", title: "Do not change"}, {id: spec.id, fav: true}]})});
  try {
    const result = await installDashboard(mock.url, "age", spec);
    assert.ok(result.backup);
    assert.equal(mock.files.get(result.backup.slice(1) + ".dashboard.json"), old);
    assert.deepEqual(JSON.parse(mock.files.get(path)!), spec);
    const entries = JSON.parse(mock.files.get("dashboards/_index.json")!).dashboards;
    assert.equal(entries.length, 2); assert.equal(entries[0].title, "Do not change"); assert.equal(entries[1].fav, true);
    assert.equal((await installDashboard(mock.url, "age", spec)).backup, undefined);
    assert.equal(JSON.parse(mock.files.get("dashboards/_index.json")!).dashboards.length, 2);
  } finally { await mock.close(); }
});
test("only 404 means no manifest; auth failures or malformed existing JSON never erase the library", async () => {
  for (const status of [401, 500]) {
    const mock = await mockFiles({}, status);
    try { await assert.rejects(installDashboard(mock.url, "age", spec), /Cannot read|needs authentication/); assert.equal(mock.writes(), 0); }
    finally { await mock.close(); }
  }
  const invalid = await mockFiles({"dashboards/_index.json": "broken"});
  try { await assert.rejects(installDashboard(invalid.url, "age", spec)); assert.equal(invalid.writes(), 0); }
  finally { await invalid.close(); }
  const empty = await mockFiles({});
  try { await installDashboard(empty.url, "age", spec); assert.ok(empty.files.has("dashboards/_index.json")); }
  finally { await empty.close(); }
});

test("HTTP 200 login responses are reported as authentication failures in discovery and Files", async () => {
  const mock = await mockFiles({}, 200, "existing_key");
  try {
    await assert.rejects(projectsAt(mock.url), /Kineviz is running.*needs authentication/);
    await assert.rejects(findDesktop([mock.url]), /Kineviz is running.*needs authentication/);
    await assert.rejects(installDashboard(mock.url, "age", spec), /needs authentication/);
    assert.equal(mock.writes(), 0);
  } finally { await mock.close(); }
});

test("authenticated installer sends the existing key to project discovery and every Files request", async () => {
  const mock = await mockFiles({}, 200, "existing_key");
  try {
    const access = {apiKey: "existing_key"};
    assert.equal(chooseProject(await projectsAt(mock.url, access), target)._id, "age");
    const result = await installDashboard(mock.url, "age", spec, access);
    assert.deepEqual(JSON.parse(mock.files.get(result.path.slice(1))!), spec);
    assert.ok(mock.authorizedRequests() > 5);
    assert.ok(!JSON.stringify([...mock.files]).includes(access.apiKey), "credentials must not be written into project files");
    await assert.rejects(projectsAt(mock.url, {apiKey: "wrong_key"}), /needs authentication/);
  } finally { await mock.close(); }
});

test("server URLs reject Markdown and embedded secrets; API keys require HTTPS off loopback", async () => {
  assert.equal(normalizeServerUrl("http://localhost:80/"), "http://localhost");
  assert.equal(normalizeServerUrl("https://kineviz.example/graphxr/"), "https://kineviz.example/graphxr");
  assert.throws(() => normalizeServerUrl("[http://localhost:80](http://localhost:80)"), /plain URL/);
  for (const url of ["file:///tmp/local", "http://user:secret@localhost", "http://localhost?key=secret", "http://localhost/#secret"]) {
    assert.throws(() => normalizeServerUrl(url), /without embedded credentials/);
  }
  await assert.rejects(projectsAt("http://kineviz.example", {apiKey: "existing_key"}), /requires HTTPS/);
});
