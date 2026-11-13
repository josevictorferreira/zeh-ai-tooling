# Implementation Plan: `governor` Extension (phase steering, tool budget and tool-output spilling)

**Date:** 2026-10-30, revised 2026-11-13 after a review against the installed Pi API (§10 lists what changed and why)
**Source paper:** *HarnessPro: Recursive Harness Self-Improvement with Pareto Optimization for Performance-Cost Trade-offs* (Pan et al., arXiv:2610.26770)
**Written against:** `@earendil-works/pi-coding-agent` 1.0.0 types in `node_modules`, `pi` 0.87.1 binary, and the conventions in `AGENTS.md`. Only APIs present in both are used (§2).

---

## 1. Context and motivation

HarnessPro evolves agent harnesses for both pass rate and cost. Its abstract reports, for the heavy mode on Terminal-Bench 2, SWE-Bench Pro and ProgramBench, +2.0 points of pass rate and a 26.1% lower per-task cost than the RHO baseline.

This extension ports four runtime mechanisms attributed to the evolved harnesses:

1. **Tool-call budgets per task profile** (`lean`, `standard`, `deep`).
2. **Phase-gated steering.** As tool calls accumulate, the model is told to economise, then to converge, then to stop.
3. **Steering delivered in tool results**, never in the system prompt, so the cached prefix is untouched.
4. **Tool-output compaction with a disk spill.** Repeated lines are collapsed, oversized output is cut to head + tail, and the full text stays readable on disk.

**Honesty note.** The abstract confirms the headline numbers only. The phase names, the thresholds in §3 and the 4,000 / 2,400 / 900 character limits come from the first draft's reading of the evolved harnesses and have not been re-checked against the paper body or its released code. They were also tuned on unattended benchmark tasks, not interactive sessions. Treat them as starting values; §9.6 gives the data to tune them with.

### Non-goals
- No offline harness search (trajectory analyzer, planner, editor, synthesized tests). Only the evolved runtime policies are ported.
- No change to the system prompt, the model or the thinking level.
- No automatic profile selection (§10).
- No information loss: output is never cut unless a complete copy is readable on disk.
- No session errors from the governor itself: compaction and spilling fail open.

---

## 2. Findings that shape the design

1. **`terminate: true` ends the run without another model call.** In `pi-agent-core/dist/agent-loop.js`, a blocked `tool_call` becomes an error tool result, and `hasMoreToolCalls = !executedToolBatch.terminate`. If every call in the batch terminates, the loop stops there: the model never sees the "synthesize your final answer" reason. The first draft returned `terminate: true` on the first blocked call, which would have ended runs silently, the opposite of its own success criterion. Hence the two-stage stop in §4.3.
2. **Tool calls from one assistant message run in parallel**, and all `tool_call` handlers of a batch run before any `tool_result`. A counter incremented in `tool_call` can jump past a threshold between two results, so `count === economyAfter` may never be true. Steering must be driven by "phase changed since the last injection", not by equality (§4.4).
3. **Pi already truncates and spills.** `bash` keeps the last 50 KB / 2,000 lines and writes the full output to a temp file exposed as `details.fullOutputPath`. `read`, `grep`, `find` and `ls` are capped at 50 KB / 2,000 lines. The governor is therefore a *tighter second stage*, not the only guard, and for a bash result Pi has already truncated, the only complete copy is `details.fullOutputPath`.
4. **Compacting `read` would loop.** The compacted text tells the model to `read` a slice of the spill; if `read` results were compacted too, any slice over the limit would be cut again and files over 4,000 characters could never be read in full. `read` is never compacted (§4.5).
5. **Nested calls are not model turns.** In 1.0.0, calls issued by another tool (`ctx.executeTool`, codemode) carry `parentToolCallId` and their results go to the calling tool, not the transcript. They must not consume budget, receive steering or be compacted. On 0.87.1 the field is absent and nested calls do not exist, so `event.parentToolCallId` is simply `undefined`.
6. **`structuredContent` is dropped when `content` is replaced** (1.0.0). The `tool_result` handler returns `structuredContent: event.structuredContent` along with the new content.
7. **Both versions provide** `ToolCallEventResult.terminate`, `agent_settled`, `ctx.ui.setStatus`, `pi.appendEntry`, `getAgentDir()` and `ctx.sessionManager.getSessionId()`.
8. **Sibling state lives under the Pi agent dir**, not in the project: `join(getAgentDir(), "<plugin>", cwd.replace(/[^A-Za-z0-9]/g, "-"))` in `skill-state/checkpoints.ts` and `subagents/state.ts`. `read` accepts absolute paths, so spills can live there and the project tree and its git ignore files are never touched.
9. **Subagents are separate `pi` processes that load every extension.** Each child gets its own governor and its own counter; the launcher forwards `PI_GOVERNOR_*` like any other differing variable. A `subagent_wait` in the parent is one tool call. `/state-run` runs its own model loop outside the conversation and is unaffected.
10. **Tests are `node --test '*/*.test.ts'`** (`bun run test`) with `node:test` and `.ts` import specifiers, as in `tts/queue.test.ts`. There is no `bun test` setup.
11. **Nix needs no change.** `harnesses/pi/default.nix` installs every `plugins/pi/<name>/` that has an `index.ts`. The directory only has to be tracked (`git add`) before `nix flake check`.

---

## 3. Profiles and thresholds

| Profile | Intended for | Economy after | Convergence after | Reminder every | Finalize (last allowed call) |
| --- | --- | :---: | :---: | :---: | :---: |
| `lean` | Localized edits, mechanical cleanup, bounded queries | 6 | 12 | 3 | 20 |
| `standard` *(default)* | Features, bug fixes, multi-file refactoring, debugging | 14 | 26 | 6 | 44 |
| `deep` | Architecture investigations, latent bugs, multi-service setup | 20 | 36 | 8 | 60 |
| `off` | No budget and no steering; compaction still runs | - | - | - | - |

Semantics, with `count` = top-level tool calls allowed so far in the current run:

- `count <= economyAfter`: **normal**.
- `economyAfter < count <= convergenceAfter`: **economy**. One reminder on entry.
- `convergenceAfter < count <= finalizeAfter`: **convergence**. A reminder on entry and again every `reminderEvery` calls.
- Call number `finalizeAfter + 1` and later: **halt**. Blocked (§4.3).

A **run** is everything triggered by one user prompt. The counter resets in `before_agent_start`, so the budget is per prompt and a user who answers "continue" grants a fresh one. This is the deliberate interactive-use reading of a per-task budget.

---

## 4. Architecture

### 4.1 Files

```text
plugins/pi/governor/
├── index.ts            # extension factory: hooks, status text, /governor
├── compactor.ts        # pure: dedupe, head/tail cut, replacement text; plus the spill writer
├── profiles.ts         # pure: profile table, phaseFor(), nextSteering(), message templates
├── compactor.test.ts
├── profiles.test.ts
└── README.md
```

No `types.ts`: the few interfaces live next to the code that owns them. Names are camelCase (`economyAfter`, `convergenceAfter`, `reminderEvery`, `finalizeAfter`), matching the sibling plugins.

### 4.2 State (in memory, per process)

```ts
interface RunState {
  profile: ProfileName;        // from PI_GOVERNOR_PROFILE, changed by /governor set
  count: number;               // allowed top-level tool calls this run
  blocked: number;             // calls blocked by the budget this run
  lastSteerPhase: Phase;       // phase of the last injected reminder
  lastSteerCount: number;      // count at the last injected reminder
  compactions: number;
  charsSaved: number;
}
```

`/governor set` lasts until the process exits or `/reload`; it is not persisted. The counters reset per run.

### 4.3 `tool_call`: budget

```
skip if disabled, profile is off, or event.parentToolCallId is set
if count >= finalizeAfter:
    blocked += 1
    first blocked batch  -> { block: true, reason }                      // model gets one more turn
    later blocked calls  -> { block: true, reason, terminate: true }     // model ignored it: end the run
else:
    count += 1
update status text
```

"First blocked batch" is decided by a flag that flips in `turn_end`: every blocked call of the same assistant message gets the non-terminating answer, and any call blocked in a later turn terminates. The reason text:

```text
Tool budget exhausted (44/44). No further tool calls will run in this turn. Keep the current changes and write the final answer from the evidence you already have; say what is unverified.
```

This guarantees one model turn to write the answer, and still ends a run that keeps calling tools. A call blocked by another extension (the codegraph search nudge) has already been counted if governor ran first; that is one call of slack and not worth ordering logic.

### 4.4 `tool_result`: compaction, then steering

Skip everything for nested results (`event.parentToolCallId`). The handler wraps its body in `try/catch` and returns `undefined` on any failure, so a broken spill or compaction always leaves the original result in place.

**Steering** is computed by a pure function and injected into at most one result per decision:

```ts
// profiles.ts
function nextSteering(profile, count, lastSteerPhase, lastSteerCount): { phase, text } | undefined
```

- phase is `economy` and `lastSteerPhase` is `normal` -> economy reminder.
- phase is `convergence` and (`lastSteerPhase` is not `convergence`, or `count - lastSteerCount >= reminderEvery`) -> convergence reminder.
- otherwise nothing.

The handler updates `lastSteerPhase` / `lastSteerCount` synchronously before any `await`, so parallel results of one batch cannot both inject. The text is appended as a new `{ type: "text" }` block, which also works for image-only results:

```text
[Governor: economy, 15/44 tool calls] Batch independent searches and reads into one turn, skip progress narration, and do not re-read unchanged files.
```
```text
[Governor: convergence, 27/44 tool calls, 17 left] Stop broad exploration. Verify the exact change, fix concrete failures, remove temporary files, and prepare the final answer.
```

Stating the remaining calls lets the model plan its last steps instead of discovering the cap by hitting it.

### 4.5 Compaction rules

Applies to text blocks of results from tools in `PI_GOVERNOR_COMPACT_TOOLS` (default `bash,grep,find,ls`). Never to `read`, `edit`, `write`, images, or results at or under the limit (those do no disk I/O at all).

1. If the text is longer than `maxChars`, collapse runs of identical consecutive lines into the line plus `[previous line repeated N times]`.
2. If it is still longer, obtain a path to the full text:
   - a bash result with `details.fullOutputPath` reuses that path (Pi already wrote the complete output; the text in hand is only its last 50 KB);
   - otherwise write the original, un-deduplicated text to the spill directory (§5).
3. Replace the text with head + marker + tail, cutting at line boundaries where a newline exists inside the slice:

```text
[Governor: output compacted from 35,420 to 3,300 chars. Full output: /home/u/.pi/agent/governor/<cwd>/<session>/call_01.txt]
<head, up to headChars>
... [32,120 chars omitted; read the file above with offset/limit for a specific section] ...
<tail, up to tailChars>
```

If the spill write fails, the result is left uncompacted. Nothing is ever cut without a readable full copy.

Compaction happens once, when the result is produced, and is deterministic; earlier messages are never rewritten, so the prompt cache prefix stays valid.

---

## 5. Spill storage

- **Location:** `join(getAgentDir(), "governor", <cwd slug>, <sessionId>, <toolCallId>.txt)`, with the cwd slug built like the siblings' and the tool call id sanitised with `/[^A-Za-z0-9._-]/g -> "_"` (provider ids can contain `|` and `/`).
- **Git:** nothing to do. Spills are outside the project, so `.gitignore` and `.git/info/exclude` are not modified.
- **Cleanup:** on `session_start`, delete spill files under this cwd's directory older than 7 days, fire-and-forget, errors ignored. No command for it.

---

## 6. User interface

### 6.1 Status text

`ctx.ui.setStatus("governor", ...)`, updated on every allowed or blocked call and on `/governor set`, guarded by `ctx.hasUI`:

- `🎯 lean 4/20`
- `⚡ std econ 16/44`
- `🔥 deep conv 38/60`
- `🛑 std halt 44/44`
- cleared (`undefined`) when the profile is `off` or the extension is disabled.

### 6.2 `/governor`

- `/governor`: profile, phase, count and thresholds, compactions and characters saved this run, spill directory.
- `/governor set <lean|standard|deep|off>`: change the profile for this process. Takes effect on the next tool call, including mid-run.
- `/governor reset`: zero the counter and the steering state for the current run (the escape hatch after a halt, without sending a new prompt).

---

## 7. Environment variables

| Variable | Default | Purpose |
| --- | :---: | --- |
| `PI_GOVERNOR_ENABLED` | `1` | `0` registers nothing at all |
| `PI_GOVERNOR_PROFILE` | `standard` | `lean`, `standard`, `deep` or `off`; an unknown value falls back to `standard` with one `ui.notify` warning |
| `PI_GOVERNOR_MAX_CHARS` | `4000` | Text length above which a result is compacted |
| `PI_GOVERNOR_HEAD_CHARS` | `2400` | Characters kept from the start |
| `PI_GOVERNOR_TAIL_CHARS` | `900` | Characters kept from the end |
| `PI_GOVERNOR_COMPACT_TOOLS` | `bash,grep,find,ls` | Tools whose results may be compacted; `read` is ignored if listed |

---

## 8. Implementation and verification steps

```
1. compactor.ts + compactor.test.ts
     dedupe, head/tail cut at line boundaries, replacement text, spill path + id sanitising
     verify: bun run test   (short text untouched; repeated lines collapse and stay under the
             limit without a spill; long text yields head/marker/tail and the spill holds the
             original bytes; a failing writer returns the input unchanged)

2. profiles.ts + profiles.test.ts
     table, phaseFor(), nextSteering()
     verify: bun run test   (boundaries at economyAfter, convergenceAfter, finalizeAfter;
             a count that jumps 13 -> 18 still yields exactly one economy reminder;
             convergence cadence; `off` never steers)

3. index.ts
     before_agent_start reset, tool_call budget with two-stage stop, turn_end flag,
     tool_result compaction + steering, session_start prune, agent_settled telemetry,
     status text, /governor
     verify: bun run check && bun run test

4. Smoke tests against the real binary (no TUI needed)
     compaction:  pi --no-session -ne -nc -ns -np -e governor/index.ts --mode json \
                    -p "run: seq 1 20000"            -> result text carries the Governor
                                                        header and the spill file exists
     budget:      PI_GOVERNOR_PROFILE=lean, a prompt that needs > 20 separate bash calls
                    -> call 21 is blocked, the model then answers in text; the JSON stream
                       shows one blocked batch and a final assistant message
     also check in the JSON stream whether a `steer`-triggered run (subagent hand-back)
     fires before_agent_start; if it does not, note in the README that such runs continue
     the previous budget.

5. Docs and repo checks
     governor/README.md; add governor to the STRUCTURE and WHERE TO LOOK tables of
     plugins/pi/AGENTS.md and to plugins/pi/README.md
     verify: git add -A && nix flake check
```

---

## 9. Success criteria

1. **Compaction:** a bash result over 20 KB reaches the model at about 3.5 KB, and the path in its header contains the complete output.
2. **Retrievability:** `read` on that path with `offset`/`limit` returns the slice uncompacted.
3. **Budget:** when the cap is hit, the model gets exactly one further turn and uses it to answer; a run that keeps calling tools is ended on the next batch.
4. **No overhead on small results:** results at or under the limit are returned untouched with no disk I/O.
5. **Cache:** the system prompt and all earlier messages are byte-identical with and without the extension; only new tool results differ.
6. **Measurable:** each run that made tool calls appends one `governor-run` custom entry via `pi.appendEntry` at `agent_settled` (`profile`, `count`, `blocked`, final phase, `compactions`, `charsSaved`). Custom entries never enter model context. These entries are the evidence for tuning §3 and §7.
7. **Fail open:** with the spill directory made unwritable, tool results arrive unmodified and no error reaches the session.

---

## 10. Review record (2026-11-13)

Changed from the first draft:

| First draft | Now | Reason |
| --- | --- | --- |
| Block with `terminate: true` at the cap | Block once without `terminate`, terminate only if the model calls tools again | §2.1: `terminate` skips the model's follow-up, so no final answer would be written |
| Steering when `count === economyAfter` and on a modulo of the count | `nextSteering()` driven by phase change and distance since the last reminder, one injection per batch | §2.2: parallel batches skip exact counts and would inject several times |
| Compact `bash`, `read` and custom tools | `bash,grep,find,ls` by default, `read` never, others opt-in | §2.4: compacting `read` makes the spill unreadable; custom tool output (web fetch, subagent results) is usually the deliverable |
| Always write a spill | Reuse `details.fullOutputPath` for bash output Pi already truncated | §2.3: the governor only sees the last 50 KB of such output |
| Spills in `<cwd>/.pi/tool-spill`, auto-edit of `.gitignore` or `.git/info/exclude` | Spills under `getAgentDir()/governor/...`, no git handling | §2.8: matches sibling plugins and never writes into the project |
| `/governor clean`, "or session shutdown" pruning | 7-day prune at `session_start` | One defined behaviour instead of two optional ones |
| `auto` profile from prompt keywords | Removed | English keyword matching misfires (and the user also writes Portuguese); a wrong `lean` guess means a hard cap at 20 calls |
| "Reasoning Effort" column | Removed | No step implemented it; `pi.setThinkingLevel` would override the user's setting, and some Velox upstreams reject the reasoning parameter |
| "Audit log (if AUDIT_ENABLED)", `types.ts` | One `governor-run` entry per run, no flag, no `types.ts` | The flag was undefined; the entry makes the success criteria checkable |
| Counter "reset or adjust" | Reset per user prompt | Was undefined |
| Status updated at `agent_settled` | Updated on every tool call | Otherwise the count is stale for the whole run |
| `bun test`, "TypeScript 5 strict typecheck" | `bun run test` (`node --test`) and `bun run check` | §2.10 |
| "Nix derivation verification" | `git add -A && nix flake check` | §2.11 |
| Mixed names (`strict_after_tools`, `GOVERNOR_MAX_CHARS`, two spill paths) | One camelCase vocabulary, `PI_GOVERNOR_*` only, one path | Internal contradictions |
| Thresholds "empirically validated" | Marked as unverified starting values | §1 honesty note |

Possible follow-ups, deliberately out of scope: an `auto` profile backed by a cheap model call instead of keywords; per-subagent-type profiles; a tail-heavy cut for bash (errors usually sit at the end, and 900 tail characters may prove too few once `governor-run` data exists).
