import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {cursorTo, clearLine} from "node:readline";
import {setTimeout} from "node:timers/promises";
import {compose, root, rows, run} from "./runtime.ts";
import {parseCsv} from "./csv.ts";
import {replayPlan} from "../streaming/pacing.ts";

interface Service {Service: string; ID: string; State: string; ExitCode: number}
export interface StreamProgress {
  total: number | null;
  transactions: number | null;
  receipts: number | null;
  producer: string;
  producerExit: number;
  sink: string;
  prepared: boolean;
  database: string;
}

export function progressState(p: StreamProgress): {label: string; done: boolean} {
  if (p.database !== "running") return {label: "Database stopped", done: true};
  if (!p.prepared) return {label: "Not prepared: ./gxr stream prepare", done: true};
  if (p.transactions !== p.receipts) return {label: "Receipt / graph count mismatch", done: true};
  if (p.producer === "exited" && p.producerExit === 0 && p.total !== null && p.transactions !== null && p.transactions >= p.total) {
    return {label: p.total === 0 ? "No transactions to replay" : "Complete", done: true};
  }
  if (p.producer === "exited" && p.producerExit !== 0) return {label: `Producer stopped (exit ${p.producerExit})`, done: true};
  if (p.producer === "missing") return {label: "Ready: ./gxr stream up", done: true};
  if (p.sink !== "running") return {label: "Paused: sink is stopped", done: true};
  if (p.producer === "running") return {label: "Replaying", done: false};
  if (p.producer === "exited") return {label: "Catching up", done: false};
  return {label: `Producer ${p.producer}`, done: true};
}

export function formatProgress(p: StreamProgress, width = 24): string {
  const n = p.transactions === null || p.receipts === null ? null : Math.min(p.transactions, p.receipts);
  const ratio = p.total === null || n === null ? null : p.total === 0 ? 0 : Math.min(1, n / p.total);
  const filled = ratio === null ? 0 : Math.floor(ratio * width);
  // Don't round an unfinished replay up to 100%.
  const percent = ratio === null ? " --%" : `${Math.floor(ratio * 100)}%`.padStart(4);
  const count = (value: number | null) => value === null ? "?" : value.toLocaleString("en-US");
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${percent}  ${count(n)}/${count(p.total)} stored | ${progressState(p).label}`;
}

/** Compose releases return either a JSON array or one object per line. */
function services(): Service[] {
  const raw = compose(["ps", "-a", "--format", "json"], undefined, false, true).trim();
  return raw ? raw.startsWith("[") ? JSON.parse(raw) as Service[] : raw.split("\n").map(line => JSON.parse(line) as Service) : [];
}

export function readStreamProgress(): StreamProgress {
  const state = services();
  const producer = state.find(s => s.Service === "producer");
  const p: StreamProgress = {
    total: null, transactions: null, receipts: null, prepared: false,
    producer: producer?.State || "missing", producerExit: producer?.ExitCode || 0,
    sink: state.find(s => s.Service === "sink")?.State || "missing",
    database: state.find(s => s.Service === "db")?.State || "missing",
  };
  let limit: string | undefined;
  if (producer) {
    const info = JSON.parse(run("docker", ["inspect", "--format", "{{json .}}", producer.ID])) as {Config: {Env: string[]}; State: {StartedAt: string}};
    // Read the running container's limit, not the status command's environment:
    // REPLAY_LIMIT=100 ./gxr stream up does not persist in the calling shell.
    limit = info.Config.Env.find(value => value.startsWith("REPLAY_LIMIT="))?.slice("REPLAY_LIMIT=".length);
    const since = info.State.StartedAt.startsWith("0001-") ? [] : ["--since", info.State.StartedAt];
    const logs = run("docker", ["logs", ...since, "--tail", "100", producer.ID]);
    for (const line of logs.split("\n")) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (typeof entry.total === "number" && Number.isSafeInteger(entry.total) && entry.total >= 0) p.total = entry.total;
      } catch { /* Kafka warnings and non-JSON startup output are not progress. */ }
    }
  }
  if (p.total === null) {
    const file = join(root, ".generated/paysim-schemaless/transactions.csv");
    if (existsSync(file)) p.total = replayPlan(Math.max(0, parseCsv(readFileSync(file, "utf8")).length - 1), {REPLAY_LIMIT: limit}).total;
  }
  if (p.database !== "running") return p;
  p.prepared = Boolean(rows("SELECT to_regclass('public.replay_receipts') IS NOT NULL AND to_regclass('paysim_stream.transaction') IS NOT NULL AS prepared")[0].prepared);
  if (p.prepared) {
    const counts = rows("SELECT (SELECT count(*) FROM public.replay_receipts) AS receipts, (SELECT count(*) FROM paysim_stream.transaction) AS transactions")[0];
    p.receipts = Number(counts.receipts);
    p.transactions = Number(counts.transactions);
  }
  return p;
}

export async function streamStatusCommand(args: string[]): Promise<void> {
  if (args.some(arg => !["--once", "--watch", "--details"].includes(arg)) || (args.includes("--once") && args.includes("--watch"))) {
    throw new Error("Use ./gxr stream status [--once | --watch | --details]");
  }
  const details = args.includes("--details");
  const watch = !details && !args.includes("--once") && (Boolean(process.stdout.isTTY) || args.includes("--watch"));
  const redraw = watch && Boolean(process.stdout.isTTY);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  if (watch) console.log("PaySim replay · refresh every 2s · Ctrl+C stops only this monitor");
  let p: StreamProgress | undefined;
  try {
    do {
      p = readStreamProgress();
      const columns = process.stdout.columns || 80;
      const width = redraw ? Math.max(1, Math.min(24, columns - formatProgress(p, 0).length - 1)) : 24;
      let line = formatProgress(p, width);
      if (redraw && line.length >= columns) line = `${line.slice(0, Math.max(0, columns - 2))}…`;
      if (redraw) { cursorTo(process.stdout, 0); clearLine(process.stdout, 0); process.stdout.write(line); }
      else console.log(line);
      if (!watch || progressState(p).done || controller.signal.aborted) break;
      try { await setTimeout(2000, undefined, {signal: controller.signal}); }
      catch (error) { if (!controller.signal.aborted) throw error; }
    } while (!controller.signal.aborted);
  } finally {
    if (redraw) process.stdout.write("\n");
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  if (controller.signal.aborted) console.log("Monitor stopped; replay continues unchanged.");
  if (details && p) {
    console.log(compose(["ps", "-a"], undefined, false, true));
    console.log(JSON.stringify({landed_transactions: p.receipts, transaction_vertices: p.transactions}, null, 2));
    console.log(compose(["logs", "--tail", "3", "producer", "sink"], undefined, false, true));
    if (services().some(s => s.Service === "broker" && s.State === "running")) {
      console.log(compose(["exec", "-T", "broker", "/opt/kafka/bin/kafka-consumer-groups.sh", "--bootstrap-server", "broker:9092", "--describe", "--group", "paysim-age-sink"], undefined, false, true));
    }
  }
}
