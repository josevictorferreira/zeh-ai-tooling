import test from "node:test";
import assert from "node:assert/strict";
import {
  PROFILES,
  phaseFor,
  nextSteering,
  formatStatus,
  isProfileName,
} from "./profiles.ts";

test("isProfileName recognises valid profiles", () => {
  assert.equal(isProfileName("lean"), true);
  assert.equal(isProfileName("standard"), true);
  assert.equal(isProfileName("deep"), true);
  assert.equal(isProfileName("off"), true);
  assert.equal(isProfileName("auto"), false);
  assert.equal(isProfileName("other"), false);
});

test("phaseFor respects boundaries for standard profile", () => {
  const std = PROFILES.standard; // econ 14, conv 26, fin 44
  assert.equal(phaseFor(std, 0), "normal");
  assert.equal(phaseFor(std, 14), "normal");
  assert.equal(phaseFor(std, 15), "economy");
  assert.equal(phaseFor(std, 26), "economy");
  assert.equal(phaseFor(std, 27), "convergence");
  assert.equal(phaseFor(std, 44), "convergence");
  assert.equal(phaseFor(std, 45), "halt");
});

test("phaseFor respects boundaries for lean and deep", () => {
  const lean = PROFILES.lean; // econ 6, conv 12, fin 20
  assert.equal(phaseFor(lean, 6), "normal");
  assert.equal(phaseFor(lean, 7), "economy");
  assert.equal(phaseFor(lean, 12), "economy");
  assert.equal(phaseFor(lean, 13), "convergence");
  assert.equal(phaseFor(lean, 20), "convergence");
  assert.equal(phaseFor(lean, 21), "halt");

  const deep = PROFILES.deep; // econ 20, conv 36, fin 60
  assert.equal(phaseFor(deep, 20), "normal");
  assert.equal(phaseFor(deep, 21), "economy");
  assert.equal(phaseFor(deep, 36), "economy");
  assert.equal(phaseFor(deep, 37), "convergence");
  assert.equal(phaseFor(deep, 60), "convergence");
  assert.equal(phaseFor(deep, 61), "halt");
});

test("a count that jumps 13 -> 18 yields exactly one economy reminder", () => {
  const std = PROFILES.standard;

  // At count 13, normal phase
  const at13 = nextSteering(std, 13, "normal", 0);
  assert.equal(at13, undefined);

  // Jump to 18 (parallel batch)
  const at18 = nextSteering(std, 18, "normal", 0);
  assert.ok(at18 !== undefined);
  assert.equal(at18.phase, "economy");
  assert.match(at18.text, /\[Governor: economy, 18\/44 tool calls\]/);

  // Subsequent call while still in economy receives nothing
  const at19 = nextSteering(std, 19, "economy", 0);
  assert.equal(at19, undefined);

  const at26 = nextSteering(std, 26, "economy", 0);
  assert.equal(at26, undefined);
});

test("convergence phase reminds on entry and on cadence", () => {
  const std = PROFILES.standard; // reminderEvery: 6

  // Jump into convergence at count 27
  const at27 = nextSteering(std, 27, "economy", 0);
  assert.ok(at27 !== undefined);
  assert.equal(at27.phase, "convergence");
  assert.match(at27.text, /\[Governor: convergence, 27\/44 tool calls, 17 left\]/);

  // Within reminder window (28..32), no reminder
  assert.equal(nextSteering(std, 28, "convergence", 27), undefined);
  assert.equal(nextSteering(std, 30, "convergence", 27), undefined);
  assert.equal(nextSteering(std, 32, "convergence", 27), undefined);

  // At 33 (27 + 6), reminder fires
  const at33 = nextSteering(std, 33, "convergence", 27);
  assert.ok(at33 !== undefined);
  assert.equal(at33.phase, "convergence");
  assert.match(at33.text, /\[Governor: convergence, 33\/44 tool calls, 11 left\]/);

  // Next reminder at 39 (33 + 6)
  assert.equal(nextSteering(std, 38, "convergence", 33), undefined);
  const at39 = nextSteering(std, 39, "convergence", 33);
  assert.ok(at39 !== undefined);
  assert.equal(at39.phase, "convergence");
  assert.match(at39.text, /\[Governor: convergence, 39\/44 tool calls, 5 left\]/);
});

test("profile 'off' never steers and phase is always normal", () => {
  const off = PROFILES.off;
  assert.equal(phaseFor(off, 100), "normal");
  assert.equal(nextSteering(off, 10, "normal", 0), undefined);
  assert.equal(nextSteering(off, 100, "normal", 0), undefined);
  assert.equal(formatStatus(off, 50, 0), undefined);
});

test("formatStatus formats according to spec", () => {
  const std = PROFILES.standard;
  assert.equal(formatStatus(std, 4, 0), "🎯 std 4/44");
  assert.equal(formatStatus(std, 16, 0), "⚡ std econ 16/44");
  assert.equal(formatStatus(PROFILES.deep, 38, 0), "🔥 deep conv 38/60");
  assert.equal(formatStatus(std, 38, 0), "🔥 std conv 38/44");
  assert.equal(formatStatus(std, 44, 1), "🛑 std halt 44/44");
  assert.equal(formatStatus(std, 45, 0), "🛑 std halt 45/44");
});
