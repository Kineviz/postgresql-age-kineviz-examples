import {readFileSync} from "node:fs";
import {setTimeout} from "node:timers/promises";
import {Kafka, logLevel} from "kafkajs";
import {parseCsv} from "../src/csv.ts";
import {payment, transaction} from "./events.ts";
import {replayDelayMs, replayPlan} from "./pacing.ts";
const kafka = new Kafka({clientId: "age-demo-producer", brokers: [process.env.KAFKA_BROKER || "broker:9092"], logLevel: logLevel.WARN});
const topic = "paysim-transactions";
const records = parseCsv(readFileSync(process.env.REPLAY_CSV || "/data/transactions.csv", "utf8"));
const header = records.shift();
if (!header) throw new Error("Replay CSV is missing its header");
const plan = replayPlan(records.length, {DEMO_TIME: process.env.DEMO_TIME, REPLAY_LIMIT: process.env.REPLAY_LIMIT});
const admin = kafka.admin();
await admin.connect();
await admin.createTopics({topics: [{topic, numPartitions: 1, replicationFactor: 1}], waitForLeaders: true});
await admin.disconnect();
const producer = kafka.producer();
await producer.connect();
let sent = 0;
const started = performance.now();
console.log(JSON.stringify({total: plan.total, demoTimeSeconds: plan.demoTimeSeconds, eventsPerSecond: plan.total / plan.demoTimeSeconds}));
try {
  for (const row of records.slice(0, plan.total)) {
    const event = payment(Object.fromEntries(header.map((key, i) => [key, row[i]])));
    await producer.send({topic, messages: [{key: transaction(event).id, value: JSON.stringify(event)}]});
    sent++;
    if (sent % 1000 === 0) console.log(JSON.stringify({produced: sent, total: plan.total}));
    let delay: number;
    // Recheck the deadline because timers can wake early. Chunk long waits to
    // stay within Node's timer range without turning them into 1 ms sleeps.
    while ((delay = replayDelayMs(plan, sent, performance.now() - started)) > 0) {
      await setTimeout(Math.min(Math.ceil(delay), 2_147_483_647));
    }
  }
  console.log(JSON.stringify({produced: sent, complete: true, demoTimeSeconds: plan.demoTimeSeconds, elapsedSeconds: (performance.now() - started) / 1000, dataset: "synthetic replay"}));
} finally { await producer.disconnect(); }
