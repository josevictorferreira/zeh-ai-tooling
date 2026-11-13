# Governor (`governor`)

Unified tool-budget enforcement, phase-aware steering, and lossless tool output compaction for Pi coding agent. Inspired by the *HarnessPro* research paper ([arXiv:2610.26770](https://arxiv.org/abs/2610.26770)).

## Why

Unconstrained coding agents routinely suffer from three compounding failure modes on complex tasks:

1. **Context Bloat:** Massive terminal outputs (e.g. verbose test logs, deep directory traversals) flood context windows and evict critical prompt history.
2. **Exploration Drift:** Agents get lost in speculative, unproductive search loops rather than converging towards verifying and finishing the task.
3. **Runaway Tool Spends:** Without hard bounds, agents can enter infinite loops or drain tokens when unexpected errors occur.

`governor` addresses these with minimal cognitive and token overhead:
- **Phase-Gated Steering:** Injects short, cadence-based steering reminders directly into tool results (avoiding prompt cache invalidation).
- **Hard Tool-Call Budgets:** Halts runaway exploration once a profile threshold is reached, giving the model one turn to wrap up before terminating.
- **Lossless Compaction & Spill:** Collapses repeated lines and cuts oversized outputs to Head + Tail while preserving the full, original output on disk for retrieval via `read(offset, limit)`.

## Profiles

Profiles adapt the tool budget to task complexity:

| Profile | Economy After | Convergence After | Reminder Every | Finalize After (Cap) |
| --- | :---: | :---: | :---: | :---: |
| `lean` | 6 calls | 12 calls | 3 calls | 20 calls |
| `standard` | 14 calls | 26 calls | 6 calls | 44 calls |
| `deep` | 20 calls | 36 calls | 8 calls | 60 calls |
| `off` | $\infty$ | $\infty$ | $\infty$ | $\infty$ |

- **Normal phase:** Agent explores normally with no steering injected.
- **Economy phase:** Steers the agent to batch reads, skip unnecessary narration, and avoid re-reading files.
- **Convergence phase:** Reminds the agent to stop broad exploration, verify changes against tests, and write the final answer.
- **Halt:** Blocks further tool calls. If the agent continues to invoke tools in subsequent turns, the run is terminated.

## Lossless Compaction & Spill

When a command in `PI_GOVERNOR_COMPACT_TOOLS` (default `bash,grep,find,ls`) exceeds `PI_GOVERNOR_MAX_CHARS` (default 4,000 characters):
1. Runs of identical consecutive lines are collapsed (`[previous line repeated N times]`). If this brings the length under the threshold, no cut is made.
2. If still oversized, the original uncompacted bytes are saved to:
   ```
   ~/.pi/agent/governor/<cwd-slug>/<session-id>/<tool-call-id>.txt
   ```
   (For `bash` commands with an existing full output file, that file is reused directly).
3. The model receives a compact view slicing at line boundaries:
   ```text
   [Governor: output compacted from 35,420 to 3,300 chars. Full output: /home/user/.pi/agent/governor/.../call_01.txt]
   <head: up to 2,400 chars>
   ... [32,120 chars omitted; read the file above with offset/limit for a specific section] ...
   <tail: up to 900 chars>
   ```
4. Output compaction **never** touches `read`, `edit`, or `write` tools.

Spill files older than 7 days are automatically pruned at startup.

## Commands

### `/governor`
Displays current governor status: active profile, current phase, tool calls (allowed vs blocked), compactions, characters saved, and spill directory.

### `/governor set <lean|standard|deep|off>`
Switches the active profile mid-session. Takes effect on the very next tool call.

### `/governor reset`
Resets the tool count and steering cadence for the current run (useful as an escape hatch when a budget halt occurs).

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PI_GOVERNOR_ENABLED` | `1` | Set to `0`, `false`, or `off` to disable governor entirely. |
| `PI_GOVERNOR_PROFILE` | `standard` | Default profile: `lean`, `standard`, `deep`, or `off`. |
| `PI_GOVERNOR_MAX_CHARS` | `4000` | Output length threshold before compaction is triggered. |
| `PI_GOVERNOR_HEAD_CHARS` | `2400` | Maximum characters to retain from the output head. |
| `PI_GOVERNOR_TAIL_CHARS` | `900` | Maximum characters to retain from the output tail. |
| `PI_GOVERNOR_COMPACT_TOOLS`| `bash,grep,find,ls` | Comma-separated list of tools eligible for compaction (`read`/`edit`/`write` are always excluded). |

## Telemetry

At `agent_settled`, any run that performed tool calls persists an entry of custom type `governor-run` via `pi.appendEntry`:
```json
{
  "profile": "standard",
  "count": 18,
  "blocked": 0,
  "finalPhase": "economy",
  "compactions": 2,
  "charsSaved": 14200
}
```
Custom session entries persist without polluting the LLM context window.
