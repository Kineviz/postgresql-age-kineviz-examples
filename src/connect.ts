import {appendFileSync} from "node:fs";
import {createHash, randomBytes} from "node:crypto";
import {join} from "node:path";
import {config, root, rows, run, sql} from "./runtime.ts";
import {identifier, sqlString} from "./age.ts";
import {demoName, demos} from "./model.ts";

export function proxyCompose(args: string[], inherit = true): string {
  return run("docker", ["compose", "--project-directory", root, "--env-file", join(root, ".env"),
    "-f", join(root, "compose.yaml"), "-f", join(root, "connect/compose.yaml"), ...args], undefined, inherit);
}
export function proxyBase(): string { return `http://127.0.0.1:${config().PROXY_PORT || "9081"}`; }
export async function proxyRequest(path: string, body?: unknown, adminToken?: string): Promise<unknown> {
  const response = await fetch(`${proxyBase()}${path}`, {
    method: body === undefined ? "GET" : "POST",
    // Lifecycle checks can recreate the container between calls. Do not reuse
    // a keepalive socket from the previous proxy process after a successful up.
    headers: {"Content-Type": "application/json", "Connection": "close", "X-API-Key": config().PROXY_API_KEY,
      ...(adminToken ? {"X-Admin-Token": adminToken} : {})},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000),
  });
  const bodyText = await response.text();
  let payload: {success?: boolean; error?: string; detail?: string};
  try { payload = JSON.parse(bodyText) as typeof payload; }
  catch { throw new Error(`Proxy ${path}: HTTP ${response.status}; inspect the proxy logs`); }
  if (!response.ok || payload.success === false) throw new Error(`Proxy ${path}: ${payload.error || payload.detail || response.status}`);
  return payload;
}
export async function checkProxy(project: string): Promise<void> {
  const path = `/api/age/${encodeURIComponent(project)}`;
  await proxyRequest(`${path}/test`, {});
  const schema = await proxyRequest(`${path}/graphSchema`) as {data: {categories: {name: string}[]; relationships: unknown[]}};
  if (!schema.data.categories.length) throw new Error("The proxy discovered no vertex labels. Load the graph first.");
  const result = await proxyRequest(`${path}/query`, {query: "MATCH (n) RETURN n LIMIT 1"}) as {data: {type: string; data: {nodes?: unknown[]}}};
  if (result.data.type !== "GRAPH" || !result.data.data.nodes?.length) throw new Error("The proxy did not return a graph node.");
  console.log(`Verified proxy → AGE: ${schema.data.categories.map(c => c.name).join(", ")}; query returned a graph node.`);
}
export async function connectCommand(action: string | undefined, slug?: string): Promise<void> {
  if (action === "down") {
    proxyCompose(["stop", "proxy"]);
    console.log("Proxy stopped; PostgreSQL, graphs, and proxy registrations are preserved."); return;
  }
  if (action === "status") {
    proxyCompose(["ps", "proxy"]);
    if (slug) await checkProxy(demoName(slug));
    return;
  }
  if (action !== "up") throw new Error("Use ./gxr connect up <demo> | status [demo] | down");
  const demo = demoName(slug);
  const graph = demos[demo].graph;
  if (!rows(`SELECT graph FROM public.demo_registry WHERE graph=${sqlString(graph)}`).length) {
    throw new Error(`Load the owned demo first: ./gxr up ${demo}`);
  }
  // AGE creates the parent's primary key but does not index the child labels.
  // Canvas traversals join by ID/endpoints, not the fixture's property keys.
  const labels = rows(`SELECT name, kind FROM ag_catalog.ag_label WHERE graph=(SELECT graphid FROM ag_catalog.ag_graph WHERE name=${sqlString(graph)}) AND name NOT IN ('_ag_label_vertex', '_ag_label_edge')`);
  for (const label of labels) {
    const table = `"${identifier(graph)}"."${identifier(String(label.name))}"`;
    for (const column of label.kind === "e" ? ["id", "start_id", "end_id"] : ["id"]) {
      const index = `age_proxy_${createHash("sha256").update(`${label.name}:${column}`).digest("hex").slice(0, 16)}`;
      sql(`CREATE INDEX IF NOT EXISTS "${index}" ON ${table} (${column});`);
    }
    sql(`ANALYZE ${table};`);
  }
  let env = config();
  // Add only missing keys; never replace existing passwords or other settings.
  for (const key of ["PROXY_API_KEY", "PROXY_ADMIN_PASSWORD"]) {
    if (!env[key]) {
      // Older Kineviz builds mistake long alphanumeric API keys for encrypted
      // values when saving a project. The prefix avoids that legacy heuristic.
      const prefix = key === "PROXY_API_KEY" ? "gxr_" : "";
      appendFileSync(join(root, ".env"), `\n${key}=${prefix}${randomBytes(24).toString("hex")}\n`);
    }
  }
  env = config();
  proxyCompose(["up", "-d", "--build", "--wait", "--no-deps", "proxy"]);
  const login = await proxyRequest("/api/admin/login", {password: env.PROXY_ADMIN_PASSWORD}) as {token: string};
  const projects = await proxyRequest("/api/project/list", undefined, login.token) as {name: string; database_type: string; database_config: {graph_name?: string; database_id?: string; host?: string}}[];
  const existing = projects.find(p => p.name === demo);
  if (existing) {
    if (existing.database_type !== "age" || existing.database_config.graph_name !== demos[demo].graph || existing.database_config.database_id !== "kineviz" || existing.database_config.host !== "db") {
      throw new Error(`Existing proxy project ${demo} points elsewhere; preserving it. Review the proxy configuration.`);
    }
  } else {
    await proxyRequest("/api/project/create", {name: demo, database_type: "age", database_config: {
      type: "age", host: "db", port: 5432, database_id: "kineviz", graph_name: demos[demo].graph,
      username: "kineviz_reader", auth_type: "username_password", options: {password_env: "KINEVIZ_PASSWORD"},
    }}, login.token);
  }
  await checkProxy(demo);
  console.log(`\nKineviz → Create New Project → Database Proxy\nAPI URL: ${proxyBase()}/api/age/${demo}\nAPI Key: PROXY_API_KEY in .env\nOpen the Query tab and run: MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 50\nSee connect/README.md.`);
}
