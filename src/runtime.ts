import {spawnSync} from "node:child_process";
import {existsSync, readFileSync, writeFileSync, mkdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import {sqlString} from "./age.ts";
export const root = fileURLToPath(new URL("../", import.meta.url));
export function run(command: string, args: string[], input?: string, inherit = false): string {
  const result = spawnSync(command, args, {cwd: root, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024,
    stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"]});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || "See output above").trim()}`);
  return result.stdout || "";
}
export function config(create = false): Record<string, string> {
  const path = join(root, ".env");
  if (!existsSync(path) && create) writeFileSync(path, `POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}\nKINEVIZ_PASSWORD=${randomBytes(24).toString("hex")}\nAGE_PORT=5455\n`, {mode: 0o600});
  if (!existsSync(path)) throw new Error("No .env. Run ./gxr up <demo> first.");
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  for (const key of Object.keys(env)) if (process.env[key] !== undefined) env[key] = process.env[key]!;
  for (const key of ["POSTGRES_PASSWORD", "KINEVIZ_PASSWORD"]) if (!env[key]) throw new Error(`Set ${key} in .env`);
  return env;
}
export function compose(args: string[], input?: string, inherit = false, streaming = false): string {
  return run("docker", ["compose", "--project-directory", root, "--env-file", join(root, ".env"), "-f", join(root, "compose.yaml"), ...(streaming ? ["-f", join(root, "streaming/compose.yaml")] : []), ...args], input, inherit);
}
export function sql(query: string): string {
  return compose(["exec", "-T", "db", "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "kineviz"], `SET client_min_messages=warning;\n${query}\n`);
}
export function rows(query: string): Record<string, unknown>[] {
  return JSON.parse(sql(`SELECT coalesce(json_agg(row_to_json(q)), '[]'::json) FROM (${query.trim().replace(/;$/, "")}) q;`).trim()) as Record<string, unknown>[];
}
export function start(): void {
  const env = config(true);
  compose(["up", "-d", "--wait", "db"], undefined, true);
  sql(`CREATE EXTENSION IF NOT EXISTS age;
    CREATE TABLE IF NOT EXISTS public.demo_registry (graph text PRIMARY KEY, demo text NOT NULL, vertices bigint NOT NULL, edges bigint NOT NULL);
    DO $role$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='kineviz_reader') THEN CREATE ROLE kineviz_reader LOGIN; END IF; END $role$;
    ALTER ROLE kineviz_reader PASSWORD ${sqlString(env.KINEVIZ_PASSWORD)};
    ALTER ROLE kineviz_reader SET default_transaction_read_only=on;
    GRANT CONNECT ON DATABASE kineviz TO kineviz_reader;
    GRANT USAGE ON SCHEMA ag_catalog TO kineviz_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA ag_catalog TO kineviz_reader;`);
}
export function generated(demo: string): string { const path = join(root, ".generated", demo); mkdirSync(path, {recursive: true}); return path; }
