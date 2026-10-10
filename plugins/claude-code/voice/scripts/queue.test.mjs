import { test } from "node:test";
import assert from "node:assert/strict";
import { firstInLine, parseTicket, ticketName } from "./queue.mjs";

const t = (ms, pid, session = "s") => ticketName(pid, session, ms);

test("ticket name round-trips and sanitises the session", () => {
  const name = ticketName(42, "cc-ab/cd", 1700000000000);
  assert.equal(name, "1700000000000-42-cc-ab_cd");
  assert.deepEqual(parseTicket(name), { name, ts: 1700000000000, pid: 42, session: "cc-ab_cd" });
  assert.equal(parseTicket("junk"), undefined);
});

test("alone in the queue is ready", () => {
  const mine = t(1, 10);
  assert.deepEqual(firstInLine([mine], mine, () => true), { state: "ready", stale: [] });
});

test("a live ticket ahead means wait; later ones do not matter", () => {
  const mine = t(2, 10);
  assert.deepEqual(firstInLine([t(3, 11), mine, t(1, 12)], mine, () => true), { state: "wait", stale: [] });
});

test("dead tickets ahead are stale and do not block", () => {
  const mine = t(2, 10);
  const dead = t(1, 99);
  assert.deepEqual(firstInLine([dead, mine], mine, (pid) => pid !== 99), { state: "ready", stale: [dead] });
});

test("a live ticket behind a dead one still blocks", () => {
  const mine = t(3, 10);
  const dead = t(1, 99);
  const live = t(2, 11);
  assert.deepEqual(firstInLine([mine, live, dead], mine, (pid) => pid !== 99), { state: "wait", stale: [dead] });
});

test("same millisecond: lower pid goes first", () => {
  const a = t(1, 10);
  const b = t(1, 11);
  assert.equal(firstInLine([a, b], a, () => true).state, "ready");
  assert.equal(firstInLine([a, b], b, () => true).state, "wait");
});

test("a removed ticket is gone", () => {
  assert.equal(firstInLine([t(1, 11)], t(2, 10), () => true).state, "gone");
});

test("foreign files in the directory are ignored", () => {
  const mine = t(1, 10);
  assert.equal(firstInLine(["alert.wav", mine], mine, () => true).state, "ready");
});
