import {compose} from "./runtime.ts";

export const replayTarget = {
  graph: "paysim_stream", topic: "paysim-transactions", group: "paysim-age-sink",
} as const;

export interface ResetDatabase {
  query(sql: string): Promise<{rows: Record<string, unknown>[]}>
}
export interface ResetKafka {
  describeGroups(groups: string[]): Promise<{groups: {state: string; members: unknown[]}[]}>;
  createTopics(options: {topics: {topic: string; numPartitions: number; replicationFactor: number}[]; waitForLeaders: boolean}): Promise<unknown>;
  fetchTopicOffsets(topic: string): Promise<{partition: number; offset: string}[]>;
  setOffsets(options: {groupId: string; topic: string; partitions: {partition: number; offset: string}[]}): Promise<unknown>;
  fetchOffsets(options: {groupId: string; topics: string[]}): Promise<{topic: string; partitions: {partition: number; offset: string}[]}[]>;
}

/** Only the fixed, owned replay graph is reset. Callers must stop both writers
 * first. Advancing Kafka before the SQL transaction keeps a Kafka failure from
 * erasing payments. On any failure writers remain stopped; re-running is safe. */
export async function resetReplayState(db: ResetDatabase, kafka: ResetKafka): Promise<void> {
  const owned = await db.query("SELECT graph FROM public.demo_registry WHERE graph='paysim_stream' AND demo='paysim-schemaless'");
  if (owned.rows.length !== 1) throw new Error("Replay graph is not owned by this demo. Run ./gxr stream prepare first.");
  const groups = await kafka.describeGroups([replayTarget.group]);
  if (groups.groups.some(g => g.members.length > 0 || !["Empty", "Dead"].includes(g.state))) {
    throw new Error("Replay consumer group is still active. Leave the writers stopped and retry ./gxr stream reset --yes.");
  }
  await kafka.createTopics({topics: [{topic: replayTarget.topic, numPartitions: 1, replicationFactor: 1}], waitForLeaders: true});
  const end = await kafka.fetchTopicOffsets(replayTarget.topic);
  if (!end.length) throw new Error("Kafka returned no replay partitions; no payments were cleared.");
  await kafka.setOffsets({groupId: replayTarget.group, topic: replayTarget.topic, partitions: end});
  const actual = (await kafka.fetchOffsets({groupId: replayTarget.group, topics: [replayTarget.topic]})).find(t => t.topic === replayTarget.topic);
  if (!actual || end.some(p => actual.partitions.find(a => a.partition === p.partition)?.offset !== p.offset)) {
    throw new Error("Kafka replay position did not match; no payments were cleared.");
  }
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL lock_timeout = '15s'");
    // Keep label tables, indexes, sequences, actors and identity edges. Never use
    // CASCADE: an unexpected dependency must abort rather than widen the reset.
    await db.query(`TRUNCATE paysim_stream.performs, paysim_stream.to_client,
      paysim_stream.to_merchant, paysim_stream.to_bank, paysim_stream.transaction,
      public.replay_receipts`);
    const check = await db.query(`SELECT
      (SELECT count(*)::int FROM paysim_stream.transaction) AS transactions,
      (SELECT count(*)::int FROM public.replay_receipts) AS receipts,
      ((SELECT count(*) FROM paysim_stream.performs) + (SELECT count(*) FROM paysim_stream.to_client) +
       (SELECT count(*) FROM paysim_stream.to_merchant) + (SELECT count(*) FROM paysim_stream.to_bank))::int AS payment_edges`);
    if (!check.rows[0] || Object.values(check.rows[0]).some(n => n !== 0)) throw new Error("Replay reset did not reach zero; rolling back.");
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK"); throw error;
  }
}

export function resetStreamCommand(confirmation?: string): void {
  // Reject before even starting containers or stopping the producer.
  if (confirmation !== "--yes") throw new Error("Clears only replay payments and receipts. Confirm with ./gxr stream reset --yes. Batch data, actors and identities are preserved.");
  compose(["stop", "producer", "sink"], undefined, true, true);
  compose(["up", "-d", "--wait", "db", "broker"], undefined, true, true);
  compose(["build", "sink"], undefined, true, true);
  compose(["run", "--rm", "--no-deps", "-T", "sink", "node", "--experimental-strip-types", "streaming/reset.ts", "--yes"], undefined, true, true);
  console.log("Replay reset: 0 transactions, 0 payment edges, 0 receipts. Actors, identities and batch graphs preserved.\nProducer and sink are stopped. Open the live dashboard, then start: DEMO_TIME=120 ./gxr stream up");
}
