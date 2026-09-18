import assert from "node:assert/strict";
import {mkdtempSync, cpSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {createServer} from "node:net";
import {setTimeout} from "node:timers/promises";
import {root} from "../src/runtime.ts";

// A separate Compose deployment is deliberate: this test must never reset the
// user's actual replay or touch its Kafka offsets, passwords or data volumes.
const dir = mkdtempSync(join(tmpdir(), "age-reset-test-"));
const project = `age-reset-test-${randomBytes(5).toString("hex")}`;
const probe = createServer();
await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
const address = probe.address(); assert.ok(address && typeof address !== "string");
const port = address.port;
await new Promise<void>(resolve => probe.close(() => resolve()));
for (const file of ["gxr", "src", "streaming", "vendor", "compose.yaml", "package.json", "package-lock.json", ".dockerignore"]) cpSync(join(root, file), join(dir, file), {recursive: true});
writeFileSync(join(dir, ".env"), `POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}\nKINEVIZ_PASSWORD=${randomBytes(24).toString("hex")}\nAGE_PORT=${port}\n`, {mode: 0o600});
const env = {...process.env, COMPOSE_PROJECT_NAME: project, AGE_PORT: String(port), DEMO_TIME: "2", REPLAY_LIMIT: "7"};
function run(command: string, args: string[], input?: string): string {
  const r = spawnSync(command, args, {cwd: dir, env, encoding: "utf8", input, maxBuffer: 16 * 1024 * 1024});
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}
const compose = (args: string[], input?: string) => run("docker", ["compose", "--project-directory", dir, "--env-file", join(dir, ".env"), "-p", project, "-f", "compose.yaml", "-f", "streaming/compose.yaml", ...args], input);
const sql = (query: string) => compose(["exec", "-T", "db", "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "kineviz"], query);
const paymentCount = () => Number(sql("SELECT count(*) FROM paysim_stream.transaction;"));
const preserved = () => sql(`SELECT json_build_object(
  'actors', (SELECT md5(string_agg(id::text || properties::text, '|' ORDER BY id)) FROM paysim_stream._ag_label_vertex WHERE tableoid <> 'paysim_stream.transaction'::regclass),
  'identities', (SELECT md5(string_agg(id::text || start_id::text || end_id::text || properties::text, '|' ORDER BY id)) FROM paysim_stream._ag_label_edge WHERE tableoid NOT IN ('paysim_stream.performs'::regclass,'paysim_stream.to_client'::regclass,'paysim_stream.to_merchant'::regclass,'paysim_stream.to_bank'::regclass)),
  'batch', (SELECT md5(string_agg(id::text || properties::text, '|' ORDER BY id)) FROM paysim._ag_label_vertex));`);
async function awaitPayments(n: number): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {if (paymentCount() === n) return; await setTimeout(500);}
  throw new Error(`Replay did not reach ${n} payments; found ${paymentCount()}`);
}
function verifyPacing(total: number): void {
  compose(["wait", "producer"]);
  const logs = compose(["logs", "--no-log-prefix", "producer"]);
  const entries = logs.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line) as Record<string, unknown>);
  const started = entries.find(entry => entry.eventsPerSecond !== undefined);
  const completed = entries.find(entry => entry.complete === true);
  assert.ok(started && completed, "Producer must report its pacing and completion");
  assert.equal(started.total, total);
  assert.equal(started.eventsPerSecond, total / 2);
  assert.equal(completed.produced, total);
  assert.equal(completed.demoTimeSeconds, 2);
  assert.ok(Number(completed.elapsedSeconds) >= 2, "Producer must spread the selected rows over DEMO_TIME");
  console.log(`Duration replay: ${total} payments in ${Number(completed.elapsedSeconds).toFixed(3)} seconds (DEMO_TIME=2).`);
}
try {
  assert.throws(() => run("./gxr", ["stream", "reset"]), /--yes/);
  assert.equal(compose(["ps", "-a", "-q"]).trim(), "", "Unconfirmed reset must not start containers");
  console.log("Isolated reset test: preparing actors and a seven-payment replay.");
  run("./gxr", ["stream", "prepare"]);
  run("./gxr", ["stream", "reset", "--yes"]);
  assert.equal(paymentCount(), 0, "Fresh reset must also work before a Kafka consumer group exists");
  run("./gxr", ["stream", "up"]);
  await awaitPayments(7);
  verifyPacing(7);
  sql("SELECT create_graph('paysim'); SELECT * FROM cypher('paysim', $$CREATE (:client {name:'batch sentinel'})$$) AS (v agtype);");
  const snapshot = preserved();
  run("./gxr", ["stream", "reset", "--yes"]);
  assert.equal(paymentCount(), 0);
  assert.equal(Number(sql("SELECT count(*) FROM public.replay_receipts;")), 0);
  assert.equal(preserved(), snapshot, "Actors, identity edges, and batch must survive reset exactly");
  const running = compose(["ps", "--services", "--status", "running"]).trim().split("\n");
  assert.ok(!running.includes("producer") && !running.includes("sink"));
  console.log("Isolated reset reached zero; writers stopped; actors, identities and batch hashes unchanged.");
  compose(["up", "-d", "sink"]);
  await setTimeout(6000);
  assert.equal(paymentCount(), 0, "Old Kafka messages must not repopulate the graph");
  env.REPLAY_LIMIT = "3";
  run("./gxr", ["stream", "up"]);
  await awaitPayments(3);
  verifyPacing(3);
  assert.equal(Number(sql("SELECT count(*) FROM public.replay_receipts;")), 3);
  assert.equal(Number(sql("SELECT (SELECT count(*) FROM paysim_stream.performs) + (SELECT count(*) FROM paysim_stream.to_client) + (SELECT count(*) FROM paysim_stream.to_merchant) + (SELECT count(*) FROM paysim_stream.to_bank);")), 6);
  assert.equal(preserved(), snapshot);
  run("./gxr", ["stream", "reset", "--yes"]);
  assert.equal(paymentCount(), 0);
  assert.equal(preserved(), snapshot);
  console.log("Fresh replay delivered exactly three payments and six edges; repeated reset passed.");
} finally {
  // This exact randomly named deployment was created by this test only.
  compose(["down", "--volumes", "--remove-orphans"]);
}
