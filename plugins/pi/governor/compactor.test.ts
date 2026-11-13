import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  collapseRepeatedLines,
  cutHeadTail,
  compactToolOutput,
  sanitizeToolCallId,
  spillPathFor,
  writeSpillFile,
} from "./compactor.ts";

test("sanitizeToolCallId cleans special characters", () => {
  assert.equal(sanitizeToolCallId("call_123.456-abc"), "call_123.456-abc");
  assert.equal(sanitizeToolCallId("tool/call|id:99"), "tool_call_id_99");
});

test("spillPathFor creates expected directory structure", () => {
  const p = spillPathFor("/home/user/.pi/agent", "/work/my repo", "sess-1", "tool/1");
  assert.equal(
    p,
    join("/home/user/.pi/agent", "governor", "-work-my-repo", "sess-1", "tool_1.txt"),
  );
});

test("short text under maxChars is untouched (compactToolOutput returns undefined)", async () => {
  const text = "A short output line.\nAnother line.";
  const res = await compactToolOutput(text, {
    maxChars: 100,
    headChars: 40,
    tailChars: 20,
    writeSpill: async () => {
      assert.fail("writeSpill should not be called for short text");
    },
  });
  assert.equal(res, undefined);
});

test("repeated lines collapse and stay under limit without a spill", async () => {
  // 50 identical lines of "log warning" -> each ~12 chars -> ~600 chars total
  const repeated = Array(50).fill("warning: retry connection").join("\n");
  assert.ok(repeated.length > 500);

  let spillCalled = false;
  const res = await compactToolOutput(repeated, {
    maxChars: 500,
    headChars: 200,
    tailChars: 100,
    writeSpill: async () => {
      spillCalled = true;
      return "/tmp/should-not-spill.txt";
    },
  });

  assert.equal(spillCalled, false);
  assert.ok(res !== undefined);
  assert.equal(res.compacted, true);
  assert.equal(res.spillPath, undefined);
  assert.equal(
    res.text,
    "warning: retry connection\n[previous line repeated 49 times]",
  );
  assert.ok(res.charsSaved > 400);
});

test("long text yields head/marker/tail and writes full original bytes to spill", async () => {
  const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}: detail data here`);
  const text = lines.join("\n");
  assert.ok(text.length > 2000);

  const spillTarget = join(tmpdir(), `governor-test-spill-${Date.now()}.txt`);

  try {
    const res = await compactToolOutput(text, {
      maxChars: 500,
      headChars: 200,
      tailChars: 150,
      writeSpill: async (raw) => {
        const ok = await writeSpillFile(spillTarget, raw);
        return ok ? spillTarget : undefined;
      },
    });

    assert.ok(res !== undefined);
    assert.equal(res.compacted, true);
    assert.equal(res.spillPath, spillTarget);

    // Verify header and marker
    assert.match(res.text, /\[Governor: output compacted from [\d,]+ to [\d,]+ chars\. Full output: .*\]/);
    assert.match(res.text, /\.\.\. \[[\d,]+ chars omitted; read the file above with offset\/limit for a specific section\] \.\.\./);

    // Verify head starts with line 1
    assert.ok(res.text.includes("line 1: detail data here"));
    // Verify tail contains the last line
    assert.ok(res.text.includes("line 200: detail data here"));

    // Verify spill file contains exact original bytes
    const saved = await readFile(spillTarget, "utf-8");
    assert.equal(saved, text);
  } finally {
    await rm(spillTarget, { force: true });
  }
});

test("existingSpillPath is reused without calling writeSpill", async () => {
  const text = "A".repeat(1000);
  const existingPath = "/tmp/existing-bash-output.txt";

  let writeCalled = false;
  const res = await compactToolOutput(text, {
    maxChars: 100,
    headChars: 30,
    tailChars: 20,
    existingSpillPath: existingPath,
    writeSpill: async () => {
      writeCalled = true;
      return undefined;
    },
  });

  assert.equal(writeCalled, false);
  assert.ok(res !== undefined);
  assert.equal(res.spillPath, existingPath);
  assert.ok(res.text.includes(existingPath));
});

test("a failing writer returns undefined (fail open, no cut without readable spill)", async () => {
  const text = "B".repeat(1000);

  const res = await compactToolOutput(text, {
    maxChars: 100,
    headChars: 30,
    tailChars: 20,
    writeSpill: async () => {
      // Simulate failed write (e.g. disk full, permission denied)
      return undefined;
    },
  });

  assert.equal(res, undefined);
});

test("cutHeadTail cuts at newline boundaries inside slices", () => {
  const sample = "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7";
  // headChars = 16: candidate is "line 1\nline 2\nli" -> cuts at last newline -> "line 1\nline 2"
  // tailChars = 16: candidate is "e 5\nline 6\nline 7" -> cuts at first newline -> "line 6\nline 7"
  const { head, tail, omittedChars } = cutHeadTail(sample, 16, 16);
  assert.equal(head, "line 1\nline 2");
  assert.equal(tail, "line 6\nline 7");
  assert.ok(omittedChars > 0);
  assert.equal(sample.length - head.length - tail.length, omittedChars);
});
