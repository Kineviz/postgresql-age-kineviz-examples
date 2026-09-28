import {appendFileSync} from "node:fs";
import {createHash, randomBytes} from "node:crypto";
import {join} from "node:path";
import {config, root, rows, sql, compose} from "./runtime.ts";
import {cypher, identifier, sqlString} from "./age.ts";
import {demoName, demos} from "./model.ts";

export const nativeUser = "kineviz_native_reader";
export function connectionTarget(slug?: string): {graph: string; prepare: string} {
  if (slug === "paysim-stream") return {graph: "paysim_stream", prepare: "./gxr stream prepare"};
  const demo = demoName(slug);
  return {graph: demos[demo].graph, prepare: `./gxr up ${demo}`};
}
export function connectionFields(graph: string, env = config()) {
  return {databaseType: "apacheAge", hostname: "127.0.0.1", boltPort: env.AGE_PORT || "5455",
    currentNeo4jDB: "kineviz", graphName: identifier(graph), username: nativeUser};
}
export function printConnection(graph: string): void {
  const fields = connectionFields(graph);
  console.log(`Kineviz → New project → Your database → Apache AGE\nHost: ${fields.hostname}\nPort: ${fields.boltPort}\nDatabase: ${fields.currentNeo4jDB}\nGraph Name: ${fields.graphName}\nUsername: ${fields.username}\nPassword: KINEVIZ_NATIVE_PASSWORD in .env\nKeep database writes disabled in the project.\nQuery: MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 50\nSee connect/README.md.`);
}

/** Keep the existing SQL/proxy login unchanged. Legacy Desktop credential
 * detection mistakes long all-hex plaintext for ciphertext; the new native
 * login's prefixed password works through that save/decrypt boundary. */
function prepareNativeReader(): void {
  let env = config();
  const exists = rows(`SELECT rolname FROM pg_roles WHERE rolname=${sqlString(nativeUser)}`).length > 0;
  if (!env.KINEVIZ_NATIVE_PASSWORD) {
    if (exists) throw new Error(`${nativeUser} already exists but KINEVIZ_NATIVE_PASSWORD is missing. Restore its .env value; the role and password have been preserved.`);
    appendFileSync(join(root, ".env"), `\nKINEVIZ_NATIVE_PASSWORD=age_${randomBytes(24).toString("hex")}\n`);
    env = config();
  }
  if (/^[a-z0-9]{32,}$/.test(env.KINEVIZ_NATIVE_PASSWORD)) {
    throw new Error("KINEVIZ_NATIVE_PASSWORD resembles legacy Desktop ciphertext. Use a password containing punctuation, such as the generated age_ prefix. Existing credentials were not changed.");
  }
  if (!exists) sql(`CREATE ROLE ${nativeUser} LOGIN INHERIT PASSWORD ${sqlString(env.KINEVIZ_NATIVE_PASSWORD)};`);
  sql(`GRANT kineviz_reader TO ${nativeUser};
    ALTER ROLE ${nativeUser} SET default_transaction_read_only=on;
    ALTER ROLE ${nativeUser} SET search_path=ag_catalog,public;`);
}

/** Use the Compose service address: PostgreSQL's local socket and localhost
 * rules may trust without checking a password. The password travels over stdin, never in CLI output or argv. */
export function nativeSql(query: string): string {
  const password = config().KINEVIZ_NATIVE_PASSWORD;
  if (!password || /[\r\n]/.test(password)) throw new Error("Run ./gxr connect up <demo> to prepare the native reader.");
  return compose(["exec", "-T", "db", "sh", "-c",
    `IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -X -qAt -v ON_ERROR_STOP=1 -h db -U ${nativeUser} -d kineviz`], `${password}\n${query}\n`);
}
export function checkNative(graph: string): void {
  const port = connectionFields(graph).boltPort;
  if (compose(["port", "db", "5432"]).trim() !== `127.0.0.1:${port}`) {
    throw new Error("The running database port does not match AGE_PORT on loopback. Run ./gxr db start, then retry connect.");
  }
  const extension = nativeSql("SELECT extversion FROM pg_extension WHERE extname='age';").trim();
  if (!extension) throw new Error("AGE is not installed in database kineviz.");
  const labels = nativeSql(`SELECT count(*) FROM ag_catalog.ag_label WHERE graph=(SELECT graphid FROM ag_catalog.ag_graph WHERE name=${sqlString(graph)});`).trim();
  const node = nativeSql(`${cypher(graph, "MATCH (n) RETURN n LIMIT 1")};`).trim();
  if (!node.includes("::vertex")) throw new Error(`No vertex returned by ${graph}. Load the demo first.`);
  console.log(`Verified native reader → PostgreSQL / AGE ${extension}: ${graph}, ${labels} labels, graph query returned a vertex.`);
}
export async function connectCommand(action: string | undefined, slug?: string): Promise<void> {
  if (action === "down") throw new Error("Native AGE has no proxy service to stop. Use ./gxr db stop to stop PostgreSQL, or ./gxr proxy down for a legacy proxy.");
  if (action === "status" && !slug) { console.log(compose(["ps", "db"])); return; }
  if (action !== "up" && action !== "status") throw new Error("Use ./gxr connect up <demo|paysim-stream> | status [demo|paysim-stream]");
  const {graph, prepare} = connectionTarget(slug);
  if (!rows(`SELECT graph FROM public.demo_registry WHERE graph=${sqlString(graph)}`).length) throw new Error(`Load the owned demo first: ${prepare}`);
  if (action === "up") {
    prepareNativeReader();
    // Reuse former index names to avoid duplicate indexes on migrated graphs.
    const labels = rows(`SELECT name, kind FROM ag_catalog.ag_label WHERE graph=(SELECT graphid FROM ag_catalog.ag_graph WHERE name=${sqlString(graph)}) AND name NOT IN ('_ag_label_vertex', '_ag_label_edge')`);
    for (const label of labels) {
      const table = `"${identifier(graph)}"."${identifier(String(label.name))}"`;
      for (const column of label.kind === "e" ? ["id", "start_id", "end_id"] : ["id"]) {
        const index = `age_proxy_${createHash("sha256").update(`${label.name}:${column}`).digest("hex").slice(0, 16)}`;
        sql(`CREATE INDEX IF NOT EXISTS "${index}" ON ${table} (${column});`);
      }
      sql(`ANALYZE ${table};`);
    }
  }
  checkNative(graph);
  printConnection(graph);
}
