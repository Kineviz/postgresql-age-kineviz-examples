export interface ReplayPlan {
  total: number;
  demoTimeSeconds: number;
  intervalMs: number;
}

export function replayPlan(available: number, env: {DEMO_TIME?: string; REPLAY_LIMIT?: string}): ReplayPlan {
  const demoTimeSeconds = Number(env.DEMO_TIME || 120);
  if (!Number.isFinite(demoTimeSeconds) || demoTimeSeconds <= 0 || !Number.isFinite(demoTimeSeconds * 1000)) {
    throw new Error("DEMO_TIME must be a positive finite number of seconds");
  }
  const limit = env.REPLAY_LIMIT ? Number(env.REPLAY_LIMIT) : available;
  if (env.REPLAY_LIMIT && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error("REPLAY_LIMIT must be a positive integer");
  }
  const total = Math.min(limit, available);
  return {total, demoTimeSeconds, intervalMs: total ? demoTimeSeconds * 1000 / total : 0};
}

/** Account for send latency against the original schedule, rather than adding
 * a full interval after each acknowledgement and stretching the demo. */
export function replayDelayMs(plan: ReplayPlan, sent: number, elapsedMs: number): number {
  return Math.max(0, sent * plan.intervalMs - elapsedMs);
}
