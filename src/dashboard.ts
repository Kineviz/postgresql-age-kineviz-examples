import {existsSync, readFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {config, root} from "./runtime.ts";

export interface DashboardSpec {
  version: string; id: string; title: string; icon?: string;
  sources: {id: string; kind: string; query?: string}[];
  widgets: {id: string; type: string; sourceId?: string; w: number; h?: number}[];
}
type Metadata = Record<string, unknown> & {id: string};
export interface Manifest {dashboards: Metadata[]; [key: string]: unknown}
export interface Project {
  _id: string; projectName: string; databaseType: string; hostname: string;
  boltPort?: string | number; port?: string | number; database?: string;
  currentDB?: string; currentNeo4jDB?: string; graphName?: string;
}
export interface NativeTarget {host: string; port: number; database: string; graph: string}
export const specFile = join(root, "demos/paysim-schemaless/kineviz/paysim-live.dashboard.json");
const indexPath = "dashboards/_index.json";

function normalizeHost(value: string): string {
  const host = value.trim().toLowerCase();
  return host === "localhost" ? "127.0.0.1" : host;
}
export function chooseProject(projects: Project[], target: NativeTarget, projectId?: string): Project {
  const description = `${target.host}:${target.port}/${target.database}, graph ${target.graph}`;
  const matches = projects.filter(p => {
    const database = [p.database, p.currentDB, p.currentNeo4jDB].find(v => v && !["neo4j", "default"].includes(v));
    return p.databaseType === "apacheAge" && normalizeHost(p.hostname) === normalizeHost(target.host) &&
      Number(p.boltPort || p.port || 5432) === target.port && database === target.database && p.graphName === target.graph;
  });
  if (projectId) {
    const selected = matches.find(p => p._id === projectId);
    if (!selected) throw new Error(`Project ${projectId} is not connected to native Apache AGE (${description}). Check its database settings.`);
    return selected;
  }
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new Error(`No project is connected to native Apache AGE (${description}). Create an Apache AGE project in Kineviz Desktop first.`);
  throw new Error(`Several projects match; pass a project ID: ${matches.map(p => `${p.projectName} (${p._id})`).join(", ")}`);
}
export function parseManifest(raw: string | null): Manifest {
  if (raw === null) return {dashboards: []};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("dashboards" in value) || !Array.isArray(value.dashboards) ||
      !value.dashboards.every(d => d && typeof d === "object" && typeof d.id === "string")) {
    throw new Error("Existing dashboard manifest is invalid; it has been preserved. Repair it before installing.");
  }
  return value as Manifest;
}
export function mergeManifest(existing: Manifest, spec: DashboardSpec, now = Date.now()): Manifest {
  const previous = existing.dashboards.find(d => d.id === spec.id);
  const meta: Metadata = {
    ...previous, id: spec.id, title: spec.title, icon: spec.icon,
    path: `/dashboards/${spec.id}.dashboard.json`, widgetCount: spec.widgets.length,
    updatedAt: now, origin: previous?.origin ?? "manual",
    layout: spec.widgets.map(w => ({w: w.w, h: w.h ?? 1, type: w.type})),
  };
  return {...existing, dashboards: [...existing.dashboards.filter(d => d.id !== spec.id), meta]};
}

/** Uses the same project Files endpoints as Kineviz's DashboardStore, not upload
 * (which ignores the dashboard subdirectory). Never persist connection secrets. */
export async function installDashboard(baseUrl: string, projectId: string, spec: DashboardSpec): Promise<{path: string; backup?: string}> {
  if (!/^[a-zA-Z0-9_-]+$/.test(spec.id) || !Array.isArray(spec.widgets) || !Array.isArray(spec.sources)) {
    throw new Error("Invalid dashboard file");
  }
  const prefix = `${baseUrl.replace(/\/+$/, "")}/api/files/${encodeURIComponent(projectId)}`;
  const request = (endpoint: string, body?: unknown) => fetch(`${prefix}/${endpoint}`, {
    method: body === undefined ? "GET" : "POST", redirect: "manual",
    headers: {"Content-Type": "application/json"},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  const read = async (path: string): Promise<string | null> => {
    const response = await request(`download?path=${encodeURIComponent(`/${path}`)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Cannot read ${path} (HTTP ${response.status}); existing files preserved.`);
    return response.text();
  };
  const post = async (endpoint: string, body: unknown): Promise<Response> => {
    const response = await request(endpoint, body);
    if (!response.ok) throw new Error(`Files ${endpoint} failed (HTTP ${response.status}). Check Desktop permissions.`);
    return response;
  };
  const write = async (path: string, content: string): Promise<void> => {
    const response = await request("write", {path, content});
    if (response.status === 404) { await post("create", {path, content}); return; }
    if (!response.ok) throw new Error(`Cannot write ${path} (HTTP ${response.status}).`);
  };
  // Read and validate before any mutation: an auth/server failure is never an empty library.
  const originalIndex = await read(indexPath);
  const manifest = parseManifest(originalIndex);
  const path = `dashboards/${spec.id}.dashboard.json`;
  const previousSpec = await read(path);
  const content = `${JSON.stringify(spec, null, 2)}\n`;
  await post("mkdir", {path: "dashboards"});
  let backup: string | undefined;
  if (previousSpec !== null && previousSpec !== content) {
    backup = `dashboards/backups/${spec.id}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await post("mkdir", {path: "dashboards/backups"});
    await post("create", {path: `${backup}.dashboard.json`, content: previousSpec});
    if (originalIndex !== null) await post("create", {path: `${backup}.manifest.json`, content: originalIndex});
  }
  await write(path, content);
  // The Files API has no compare-and-swap; catch edits made during this install
  // instead of knowingly replacing someone else's changed dashboard list.
  if (await read(indexPath) !== originalIndex) throw new Error("Dashboard library changed during install. Re-run to merge its latest contents.");
  const next = mergeManifest(manifest, spec);
  const indexContent = `${JSON.stringify(next, null, 2)}\n`;
  await write(indexPath, indexContent);
  if (await read(path) !== content || await read(indexPath) !== indexContent) {
    throw new Error("Dashboard readback did not match. Re-open the library and check for a concurrent edit.");
  }
  return {path: `/${path}`, ...(backup ? {backup: `/${backup}`} : {})};
}

async function projectsAt(url: string): Promise<Project[]> {
  const response = await fetch(`${url}/api/graph/neo4j/project/list`, {redirect: "manual", signal: AbortSignal.timeout(4_000)});
  if (!response.ok) throw new Error(`Project API HTTP ${response.status}`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) throw new Error("No project list returned");
  return result.content.filter((p): p is Project => p && typeof p === "object" && typeof p._id === "string" && typeof p.hostname === "string");
}
function desktopUrls(): string[] {
  const ports: unknown[] = [];
  for (const parent of [join(homedir(), "Library/Application Support"), join(homedir(), ".config")]) {
    for (const app of ["kineviz-desktop", "graphxr", "graphxr-viewer", "Electron"]) {
      const path = join(parent, app, "desktop-settings.json");
      if (!existsSync(path)) continue;
      try { ports.push((JSON.parse(readFileSync(path, "utf8")) as {serverPort?: unknown}).serverPort); } catch { /* try other known ports */ }
    }
  }
  ports.push(Number(process.env.KINEVIZ_DESKTOP_PORT), 31380, 80, 8080, 3000, 9000);
  return [...new Set(ports.filter((p): p is number => typeof p === "number" && Number.isInteger(p) && p > 0 && p <= 65535))].map(p => `http://127.0.0.1:${p}`);
}
export async function dashboardCommand(args: string[]): Promise<void> {
  let url = process.env.KINEVIZ_URL, projectId: string | undefined, json = false;
  let graph = "paysim_stream";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help") {
      console.log("Usage: ./demos/paysim-schemaless/scripts/install-dashboard.sh [projectId] [--url http://host:port] [--graph paysim_stream|paysim] [--json]"); return;
    }
    if (arg === "--json") { json = true; continue; }
    if (arg === "--url" || arg === "--graph") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--url") url = value; else graph = value;
      continue;
    }
    if (arg.startsWith("-") || projectId) throw new Error(`Unexpected argument: ${arg}`);
    projectId = arg;
  }
  if (!["paysim_stream", "paysim"].includes(graph)) throw new Error("Use --graph paysim_stream (replay) or --graph paysim (batch).");
  const env = config();
  const target: NativeTarget = {host: "127.0.0.1", port: Number(env.AGE_PORT || 5455), database: "kineviz", graph};
  let projects: Project[] | undefined;
  if (url) { url = url.replace(/\/+$/, ""); projects = await projectsAt(url); }
  else {
    for (const candidate of desktopUrls()) {
      try { projects = await projectsAt(candidate); url = candidate; break; } catch { /* next candidate */ }
    }
  }
  if (!url || !projects) throw new Error("No running Kineviz Desktop found. Start it, or use --url http://host:port.");
  const project = chooseProject(projects, target, projectId);
  const spec = JSON.parse(readFileSync(specFile, "utf8")) as DashboardSpec;
  const result = await installDashboard(url, project._id, spec);
  const output = {...result, projectId: project._id, projectName: project.projectName, title: spec.title, url};
  const nextStep = graph === "paysim_stream"
    ? "For a fresh two-minute replay: ./gxr stream reset --yes, then DEMO_TIME=120 ./gxr stream up."
    : "For the live replay, connect an Apache AGE project to graph paysim_stream. Batch totals stay steady.";
  if (json) console.log(JSON.stringify(output));
  else console.log(`Installed and verified “${spec.title}” in “${project.projectName}”.\nOpen Dashboard in the left rail → ${spec.title}. Reopen the library if it was already open.\nProject file: ${result.path}${result.backup ? `\nPrevious version backed up at ${result.backup}.*` : ""}\nPanels refresh every 2–10 seconds through this project's AGE connection. ${nextStep}`);
}
