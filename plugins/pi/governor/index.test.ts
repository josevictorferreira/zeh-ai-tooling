import test from "node:test";
import assert from "node:assert/strict";
import {
  createGovernorExtension,
  createInitialRunState,
  loadGovernorConfig,
} from "./index.ts";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolCallEvent,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

function createMockPi() {
  const handlers: Record<string, ((...args: any[]) => any)[]> = {};
  const commands: Record<string, any> = {};
  const entries: { type: string; data?: any }[] = [];

  const api: ExtensionAPI = {
    on: (event: string, handler: any) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(handler);
      return () => {};
    },
    registerCommand: (name: string, options: any) => {
      commands[name] = options;
    },
    appendEntry: (type: string, data?: any) => {
      entries.push({ type, data });
    },
  } as unknown as ExtensionAPI;

  return {
    api,
    handlers,
    commands,
    entries,
    emit: async (event: string, ...args: any[]) => {
      const list = handlers[event] || [];
      let lastResult: any;
      for (const h of list) {
        lastResult = await h(...args);
      }
      return lastResult;
    },
  };
}

function createMockCtx(overrides?: Partial<ExtensionContext>): ExtensionContext {
  const notifications: { msg: string; kind?: string }[] = [];
  const statuses: Record<string, string | undefined> = {};

  return {
    cwd: "/workspace/my-project",
    hasUI: true,
    ui: {
      notify: (msg: string, kind?: string) => {
        notifications.push({ msg, kind });
      },
      setStatus: (key: string, status: string | undefined) => {
        statuses[key] = status;
      },
    },
    sessionManager: {
      getSessionId: () => "mock-sess-123",
    },
    ...overrides,
  } as unknown as ExtensionContext;
}

test("loadGovernorConfig reads defaults and sanitises tools", () => {
  const conf = loadGovernorConfig();
  assert.equal(conf.enabled, true);
  assert.equal(conf.maxChars, 4000);
  assert.equal(conf.headChars, 2400);
  assert.equal(conf.tailChars, 900);
  assert.ok(conf.compactTools.has("bash"));
  assert.ok(conf.compactTools.has("grep"));
  assert.equal(conf.compactTools.has("read"), false);
  assert.equal(conf.compactTools.has("edit"), false);
  assert.equal(conf.compactTools.has("write"), false);
});

test("tool_call budget enforcement: first blocks without terminate, second turn terminates", async () => {
  // Use lean profile: finalizeAfter is 20
  process.env.PI_GOVERNOR_PROFILE = "lean";
  const mock = createMockPi();
  const ext = createGovernorExtension();
  ext(mock.api);

  const ctx = createMockCtx();
  await mock.emit("before_agent_start", {}, ctx);

  const mockToolCall: ToolCallEvent = {
    type: "tool_call",
    toolCallId: "call-1",
    toolName: "bash",
    input: { command: "echo 1" },
  } as ToolCallEvent;

  // Simulate 20 allowed calls
  for (let i = 0; i < 20; i++) {
    const res = await mock.emit("tool_call", { ...mockToolCall, toolCallId: `call-${i}` }, ctx);
    assert.equal(res, undefined); // allowed
  }

  // 21st call in this turn: budget exhausted, blocked without terminate
  const blocked1 = await mock.emit("tool_call", { ...mockToolCall, toolCallId: "call-21" }, ctx);
  assert.ok(blocked1 !== undefined);
  assert.equal(blocked1.block, true);
  assert.equal(blocked1.terminate, undefined);
  assert.match(blocked1.reason, /Tool budget exhausted \(20\/20\)/);

  // Turn ends
  await mock.emit("turn_end", {}, ctx);

  // Next turn: agent attempts another tool call -> should terminate
  const blocked2 = await mock.emit("tool_call", { ...mockToolCall, toolCallId: "call-22" }, ctx);
  assert.ok(blocked2 !== undefined);
  assert.equal(blocked2.block, true);
  assert.equal(blocked2.terminate, true);

  // agent_settled records governor-run entry
  await mock.emit("agent_settled", {}, ctx);
  assert.equal(mock.entries.length, 1);
  assert.equal(mock.entries[0].type, "governor-run");
  assert.equal(mock.entries[0].data.count, 20);
  assert.equal(mock.entries[0].data.blocked, 2);
  assert.equal(mock.entries[0].data.profile, "lean");
  assert.equal(mock.entries[0].data.finalPhase, "halt");

  delete process.env.PI_GOVERNOR_PROFILE;
});

test("nested tool calls and results with parentToolCallId are ignored", async () => {
  process.env.PI_GOVERNOR_PROFILE = "lean";
  const mock = createMockPi();
  const ext = createGovernorExtension();
  ext(mock.api);

  const ctx = createMockCtx();
  await mock.emit("before_agent_start", {}, ctx);

  const nestedCall: ToolCallEvent = {
    type: "tool_call",
    toolCallId: "call-root/1",
    parentToolCallId: "call-root",
    toolName: "bash",
    input: { command: "echo nested" },
  } as ToolCallEvent;

  const res = await mock.emit("tool_call", nestedCall, ctx);
  assert.equal(res, undefined);

  const nestedResult: ToolResultEvent = {
    type: "tool_result",
    toolCallId: "call-root/1",
    parentToolCallId: "call-root",
    toolName: "bash",
    input: {},
    content: [{ type: "text", text: "nested result" }],
    isError: false,
  } as ToolResultEvent;

  const resultOutcome = await mock.emit("tool_result", nestedResult, ctx);
  assert.equal(resultOutcome, undefined);

  delete process.env.PI_GOVERNOR_PROFILE;
});

test("tool_result does not compact read output, but does steer", async () => {
  process.env.PI_GOVERNOR_PROFILE = "lean"; // econ after 6
  const mock = createMockPi();
  const ext = createGovernorExtension();
  ext(mock.api);

  const ctx = createMockCtx();
  await mock.emit("before_agent_start", {}, ctx);

  // Advance count to 7 (economy phase)
  for (let i = 0; i < 7; i++) {
    await mock.emit("tool_call", {
      type: "tool_call",
      toolCallId: `call-${i}`,
      toolName: "read",
      input: { path: "foo.txt" },
    } as ToolCallEvent, ctx);
  }

  // Result from read tool with long content
  const longText = "A".repeat(5000);
  const result: ToolResultEvent = {
    type: "tool_result",
    toolCallId: "call-6",
    toolName: "read",
    input: {},
    content: [{ type: "text", text: longText }],
    isError: false,
  } as ToolResultEvent;

  const res = await mock.emit("tool_result", result, ctx);
  assert.ok(res !== undefined);
  // Content has 2 blocks: original text untouched + 1 injected steering text
  assert.equal(res.content.length, 2);
  assert.equal(res.content[0].text, longText); // NOT compacted!
  assert.match(res.content[1].text, /\[Governor: economy, 7\/20 tool calls\]/);

  delete process.env.PI_GOVERNOR_PROFILE;
});

test("/governor command supports inspect, set, and reset", async () => {
  const mock = createMockPi();
  const ext = createGovernorExtension();
  ext(mock.api);

  const notifications: string[] = [];
  const ctx = {
    cwd: "/workspace/proj",
    hasUI: true,
    ui: {
      notify: (msg: string) => notifications.push(msg),
      setStatus: () => {},
    },
  } as unknown as ExtensionCommandContext;

  const cmd = mock.commands.governor;
  assert.ok(cmd !== undefined);

  // Default status
  await cmd.handler("", ctx);
  assert.match(notifications[0], /Governor status:/);
  assert.match(notifications[0], /Profile: unlimited/);

  // Set lean
  await cmd.handler("set lean", ctx);
  assert.match(notifications[1], /Governor profile set to lean/);

  // Reset
  await cmd.handler("reset", ctx);
  assert.match(notifications[2], /Governor run counters reset/);

  // Invalid profile
  await cmd.handler("set ultra", ctx);
  assert.match(notifications[3], /Unknown profile "ultra"/);
});

test("unlimited profile never blocks tool calls but still compacts output", async () => {
  process.env.PI_GOVERNOR_PROFILE = "unlimited";
  const mock = createMockPi();
  const ext = createGovernorExtension();
  ext(mock.api);

  const ctx = createMockCtx();
  await mock.emit("before_agent_start", {}, ctx);

  // Well past the deep cap (60) with no block, across turns
  for (let i = 0; i < 200; i++) {
    const res = await mock.emit("tool_call", {
      type: "tool_call",
      toolCallId: `call-${i}`,
      toolName: "grep",
      input: { pattern: "x" },
    } as ToolCallEvent, ctx);
    assert.equal(res, undefined);
    if (i % 10 === 9) await mock.emit("turn_end", {}, ctx);
  }

  const longText = Array.from({ length: 2000 }, (_, i) => `match line ${i}`).join("\n");
  const res = await mock.emit("tool_result", {
    type: "tool_result",
    toolCallId: "call-199",
    toolName: "grep",
    input: {},
    content: [{ type: "text", text: longText }],
    isError: false,
  } as ToolResultEvent, ctx);
  assert.ok(res !== undefined);
  assert.equal(res.content.length, 1); // compacted, no steering block
  assert.match(res.content[0].text, /\[Governor: output compacted/);

  await mock.emit("agent_settled", {}, ctx);
  assert.equal(mock.entries[0].data.count, 200);
  assert.equal(mock.entries[0].data.blocked, 0);

  delete process.env.PI_GOVERNOR_PROFILE;
});
