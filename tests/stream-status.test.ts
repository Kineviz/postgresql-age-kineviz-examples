import assert from "node:assert/strict";
import {test} from "node:test";
import {formatProgress, progressState, streamStatusCommand} from "../src/stream-status.ts";
import type {StreamProgress} from "../src/stream-status.ts";

const running: StreamProgress = {
  total: 12033, transactions: 6000, receipts: 6000,
  producer: "running", producerExit: 0, sink: "running", database: "running", prepared: true,
};

test("bar reflects committed database counts and never rounds incomplete data to 100%", () => {
  assert.match(formatProgress(running, 10), /^\[████░░░░░░\]\s+49%\s+6,000\/12,033 stored \| Replaying$/);
  assert.match(formatProgress({...running, transactions: 12032, receipts: 12032}), /99%/);
  assert.doesNotMatch(formatProgress(running), /\x1b/);
});

test("producer completion waits for database catch-up; failures cannot claim completion", () => {
  assert.deepEqual(progressState({...running, producer: "exited"}), {label: "Catching up", done: false});
  const loaded = {...running, producer: "exited", receipts: 12033, transactions: 12033};
  assert.deepEqual(progressState(loaded), {label: "Complete", done: true});
  assert.match(progressState({...loaded, producerExit: 1}).label, /exit 1/);
  assert.match(progressState({...loaded, transactions: 12032}).label, /mismatch/);
  assert.equal(progressState({...loaded, producer: "running"}).label, "Replaying");
});

test("reset, unprepared and unavailable database states do not pretend to be complete", () => {
  const zero = {...running, transactions: 0, receipts: 0, producer: "exited", sink: "exited"};
  assert.match(formatProgress(zero), /0%\s+0\/12,033.*Paused/);
  assert.match(formatProgress({...zero, database: "exited", transactions: null, receipts: null}), /--%.*Database stopped/);
  assert.match(progressState({...zero, prepared: false}).label, /stream prepare/);
  assert.match(progressState({...zero, producer: "missing"}).label, /stream up/);
});

test("limits, empty data, existing extra rows and unknown targets render bounded bars", () => {
  assert.match(formatProgress({...running, total: 100, transactions: 50, receipts: 50}, 10), /\[█████░░░░░\]\s+50%\s+50\/100/);
  assert.match(formatProgress({...running, total: 100}, 10), /\[██████████\]\s+100%\s+6,000\/100/);
  assert.match(formatProgress({...running, total: null}), /--%\s+6,000\/\?/);
  const empty = {...running, producer: "exited", total: 0, transactions: 0, receipts: 0};
  assert.match(formatProgress(empty), /0%\s+0\/0.*No transactions/);
});

test("bad status flags fail before accessing Docker", async () => {
  await assert.rejects(streamStatusCommand(["--once", "--watch"]), /Use/);
  await assert.rejects(streamStatusCommand(["--unknown"]), /Use/);
});
