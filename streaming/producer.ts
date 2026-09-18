import {readFileSync} from "node:fs";
import {setTimeout} from "node:timers/promises";
import {Kafka, logLevel} from "kafkajs";
import {parseCsv} from "../src/csv.ts";
import {payment, transaction} from "./events.ts";
const kafka = new Kafka({clientId: "age-demo-producer", brokers: [process.env.KAFKA_BROKER || "broker:9092"], logLevel: logLevel.WARN});
const topic = "paysim-transactions";
const rate = Number(process.env.REPLAY_RATE || 100);
if (!Number.isFinite(rate) || rate <= 0) throw new Error("REPLAY_RATE must be positive");
const records = parseCsv(readFileSync(process.env.REPLAY_CSV || "/data/transactions.csv", "utf8"));
const header = records.shift()!;
const limit = Number(process.env.REPLAY_LIMIT || records.length);
if (!Number.isInteger(limit) || limit < 1) throw new Error("REPLAY_LIMIT must be a positive integer");
const admin = kafka.admin();
await admin.connect();
await admin.createTopics({topics: [{topic, numPartitions: 1, replicationFactor: 1}], waitForLeaders: true});
await admin.disconnect();
const producer = kafka.producer();
await producer.connect();
let sent = 0;
try {
  for (const row of records.slice(0, limit)) {
    const event = payment(Object.fromEntries(header.map((key, i) => [key, row[i]])));
    await producer.send({topic, messages: [{key: transaction(event).id, value: JSON.stringify(event)}]});
    sent++;
    if (sent % 1000 === 0) console.log(JSON.stringify({produced: sent, total: Math.min(limit, records.length)}));
    if (rate < 10000) await setTimeout(1000 / rate);
  }
  console.log(JSON.stringify({produced: sent, complete: true, dataset: "synthetic replay"}));
} finally { await producer.disconnect(); }
