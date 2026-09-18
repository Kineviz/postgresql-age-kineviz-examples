import pg from "pg";
import {setTimeout} from "node:timers/promises";
import {Kafka, logLevel} from "kafkajs";
import {replayTarget, resetReplayState} from "../src/stream-reset.ts";

if (process.argv[2] !== "--yes") throw new Error("Use ./gxr stream reset --yes from the repository root.");
const db = new pg.Client({host: "db", user: "postgres", password: process.env.POSTGRES_PASSWORD, database: "kineviz"});
const kafka = new Kafka({clientId: "age-demo-reset", brokers: ["broker:9092"], logLevel: logLevel.WARN});
const admin = kafka.admin();
try {
  await db.connect();
  await admin.connect();
  // Docker has stopped the sink, but Kafka can retain its member until the
  // session timeout. Wait for that acknowledgement before moving any offsets.
  const deadline = Date.now() + 45_000;
  for (;;) {
    const state = await admin.describeGroups([replayTarget.group]);
    if (state.groups.every(g => g.members.length === 0 && ["Empty", "Dead"].includes(g.state))) break;
    if (Date.now() >= deadline) throw new Error("Kafka still has an active replay consumer. No payments were cleared; retry the reset after it stops.");
    console.log("Waiting for Kafka to release the stopped replay consumer…");
    await setTimeout(1_000);
  }
  await resetReplayState(db, admin);
} finally {
  await admin.disconnect();
  await db.end();
}
