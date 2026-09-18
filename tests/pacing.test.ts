import assert from "node:assert/strict";
import {test} from "node:test";
import {replayDelayMs, replayPlan} from "../streaming/pacing.ts";

test("default two-minute replay uses the whole available file", () => {
  for (const total of [1, 12033, 24066]) {
    const plan = replayPlan(total, {});
    assert.equal(plan.total, total);
    assert.equal(plan.demoTimeSeconds, 120);
    assert.equal(replayDelayMs(plan, total, 0), 120000);
  }
});

test("duration follows the selected rows even with a limit larger than the file", () => {
  for (const [limit, expected] of [[100, 100], [20000, 12033]]) {
    const plan = replayPlan(12033, {DEMO_TIME: "2.5", REPLAY_LIMIT: String(limit)});
    assert.equal(plan.total, expected);
    assert.equal(replayDelayMs(plan, expected, 0), 2500);
  }
  assert.equal(replayPlan(24066, {REPLAY_LIMIT: ""}).total, 24066);
});

test("empty input completes without a delay or division by zero", () => {
  const plan = replayPlan(0, {});
  assert.equal(plan.total, 0);
  assert.equal(replayDelayMs(plan, 0, 0), 0);
});

test("pacing absorbs acknowledgement latency and recovers after a slow send", () => {
  const plan = replayPlan(4, {DEMO_TIME: "2"});
  assert.equal(replayDelayMs(plan, 1, 75), 425);
  assert.equal(replayDelayMs(plan, 2, 1200), 0);
  assert.equal(replayDelayMs(plan, 3, 1300), 200);
  assert.equal(replayDelayMs(plan, 4, 1800), 200);
  assert.equal(replayDelayMs(plan, 4, 2500), 0);
});

test("invalid durations and limits fail before replay", () => {
  for (const DEMO_TIME of ["0", "-1", "NaN", "Infinity", "abc", " ", "1e308"]) {
    assert.throws(() => replayPlan(12033, {DEMO_TIME}), /DEMO_TIME/);
  }
  for (const REPLAY_LIMIT of ["0", "-1", "1.5", "NaN", "Infinity", "abc", " "]) {
    assert.throws(() => replayPlan(12033, {REPLAY_LIMIT}), /REPLAY_LIMIT/);
  }
});
