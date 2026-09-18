import {Kafka, logLevel} from "kafkajs";
import pg from "pg";
import {replayStatement} from "../src/age.ts";
import {payment, transaction} from "./events.ts";
const client = new pg.Client({host: "db", user: "postgres", password: process.env.POSTGRES_PASSWORD, database: "kineviz"});
await client.connect();
await client.query("LOAD 'age'; SET search_path=ag_catalog,public");
const kafka = new Kafka({clientId: "age-demo-sink", brokers: [process.env.KAFKA_BROKER || "broker:9092"], logLevel: logLevel.WARN});
const admin = kafka.admin();
await admin.connect();
await admin.createTopics({topics: [{topic: "paysim-transactions", numPartitions: 1, replicationFactor: 1}], waitForLeaders: true});
await admin.disconnect();
const consumer = kafka.consumer({groupId: "paysim-age-sink"});
await consumer.connect();
await consumer.subscribe({topic: "paysim-transactions", fromBeginning: true});
let landed = 0, duplicates = 0;
await consumer.run({eachMessage: async ({message}) => {
  const event = transaction(payment(JSON.parse(message.value?.toString() || "null")));
  if (message.key?.toString() !== event.id) throw new Error("Event key does not match global_step");
  await client.query("BEGIN");
  try {
    // Kafka delivery is at least once. Commit the receipt and graph mutation in
    // the same PostgreSQL transaction before allowing Kafka to advance offsets.
    const receipt = await client.query("INSERT INTO public.replay_receipts(event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id", [event.id]);
    if (receipt.rowCount) {
      const result = await client.query(replayStatement("paysim_stream", event));
      if (result.rowCount !== 1) throw new Error(`Missing or ambiguous endpoint for ${event.id}`);
      landed++;
    } else duplicates++;
    await client.query("COMMIT");
    if ((landed + duplicates) % 100 === 0) console.log(JSON.stringify({landed, duplicates}));
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}});
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await consumer.disconnect(); await client.end();
}
process.on("SIGTERM", () => { void stop(); });
process.on("SIGINT", () => { void stop(); });
