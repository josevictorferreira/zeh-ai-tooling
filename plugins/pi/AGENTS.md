# PROJECT KNOWLEDGE BASE

**Generated:** 2026-08-24, updated 2026-09-02
**Commit:** edd5321 (+ uncommitted skill-state)
**Branch:** main

## OVERVIEW
Bun/TypeScript pi extensions, one directory each (`plugins/pi/<plugin>/index.ts`), loaded independently by pi through jiti; there is no build step. `package.json` here is the single package boundary (typecheck only). Nix installs them: see `harnesses/pi/default.nix`.

## STRUCTURE
```text
plugins/pi/
├── codegraph/      # CodeGraph CLI-backed semantic exploration
├── context7/       # Context7 documentation API client
├── hindsight/      # Hindsight memory API and automatic retention
├── lsp/            # language-server client, configuration, and pi hooks
├── notify/         # desktop notifications for agent outcomes via notify-send
├── skill-state/    # SKILL.state runtime: /state-run bounded-state agent loop
├── stt/            # microphone dictation into the prompt via Velox
├── subagents/      # tmux-pane subagents: launch/check/send/close tools, steer hand-back
├── tts/            # spoken summary of the last reply via Velox
├── web-tools/      # Velox web search and URL extraction
├── .agents/plans/  # tracked design plans
├── .agents/specs/  # reviewed implementation specs (skill-state, notify)
├── package.json    # typecheck script and dev dependencies
├── tsconfig.json   # strict no-emit TypeScript configuration
└── README.md       # plugin documentation
```

## WHERE TO LOOK
| Task | Location | Notes |
| --- | --- | --- |
| Add or change a plugin tool | `<plugin>/index.ts` | Each entry point default-exports `(pi: ExtensionAPI) => void`. |
| Understand a plugin contract | `<plugin>/README.md` | Documents tool parameters, environment variables, and external API behavior. |
| Change language-server lifecycle | `lsp/index.ts` | Lazy client startup, edit/write diagnostics, `lsp` tool, `/lsp`, shutdown cleanup. |
| Change JSON-RPC or diagnostics state | `lsp/client.ts` | Hand-rolled stdio framing, requests, notifications, file sync, pushed diagnostics. |
| Change server catalog/config merging | `lsp/servers.ts` | Built-ins, trusted project config, root discovery, validation. |
| Change package/typechecking setup | `package.json`, `tsconfig.json` | Only script is `bun run check`; compiler includes `extensions`. |
| Understand installation/loading | `README.md`, `package.json` | `pi.extensions` points at `./extensions`; plugins ship without local dependencies. |
| Understand or change the spoken-summary flow | `tts/index.ts` | `/speak` command and `ctrl+alt+s` shortcut; Velox chat summary + audio speech, local playback. |
| Understand or change the dictation flow | `stt/index.ts` | `/dictate` command and `ctrl+alt+d` shortcut; local recording via `pw-record`/`ffmpeg`, Velox transcription, transcript appended to the prompt editor. |
| Understand or change desktop notifications | `notify/index.ts`, `.agents/specs/0002-notify/plan.md` | Classifies `agent_settled` outcomes into success/question/error; sends a `notify-send`-style argv via `pi.exec` with a 5 s timeout; dedupes by assistant message id. |
| Understand the SKILL.state design and its limits | `.agents/specs/0001-skill-state-plan.md`, `skill-state/README.md` | Paper claims vs. what is reproduced; verification gates; honesty notes. |
| Change the state-run loop, retry, or telemetry | `skill-state/runner.ts` | Algorithm 1: render → complete → parse/validate → merge → execute; rollback-retry ≤ 2; per-step telemetry; `onEvent` trace. |
| Debug a state-run | `/state-log` in Pi, then `bun skill-state/tools/runlog.ts <runId> [--rejections | --step N --prompt] --cwd <project>` | Reads `~/.pi/agent/skill-state/<cwd>/logs/<runId>.jsonl`; `listRunLogs` in `runlog.ts` is shared by the command and the tool. |
| Change the state schema, merge bounds or phase policy | `skill-state/schemas.ts`, `skill-state/state.ts` | TypeBox schemas with `additionalProperties: false`; `⊕` merge with null-delete, list replacement, 6 KB cap; `phaseErrors` and `actionErrors` enforce the inspect budget, the 2-step planning limit, read-only streaks in editing, and changed-files-before-testing as rejection errors. |
| Change the action vocabulary or observation caps | `skill-state/executor.ts`, `skill-state/prompt.ts` | Repo-local actions, 200 lines / 8 KB observations; prompt text mirrors paper Appendix A.4. |
| Change the built-in SE skill or `--skill` loading | `skill-state/workflow.ts` | Spec ≤ 4 KB, used verbatim as `{spec}`. |
| Change how subagents are launched, polled or handed back | `subagents/index.ts`, `subagents/tmux.ts` | `subagent_launch/check/send/close`, `/subagents [--all]`, 1.5 s poller, `subagent-result` message via `deliverAs: "steer"`; tmux session `pi-<root id8>`, tiled panes. |
| Change what a subagent reports or how it falls back | `subagents/child.ts` | Active when `PI_SUBAGENT_TASK` is set: result/status per `agent_settled`, inbox poll, one `setModel` fallback. |
| Change subagent types, overrides or the task registry | `subagents/types.ts`, `subagents/state.ts` | Built-in explorer/researcher/worker/oracle; `~/.pi/agent/subagents/<type>.md` overrides; one JSON per task under `~/.pi/agent/subagents/<cwd>/<root>/tasks/`. |

## CODE MAP
The package has 22 TypeScript source files and no tests. Reference counts below are structural indicators from the source layout rather than a generated call graph.

| Symbol | Type | Location | Role |
| --- | --- | --- | --- |
| default | extension factory | `*/index.ts` | Registers each plugin's tools and event handlers. |
| `LspClient` | class | `lsp/client.ts:57` | Owns one language-server child process and JSON-RPC state. |
| `loadConfig` | function | `lsp/servers.ts:197` | Merges built-ins, user config, and trusted project config. |
| `findRoot` | function | `lsp/servers.ts:105` | Finds the nearest configured workspace marker without leaving the project root. |
| `clientsFor` | function | `lsp/index.ts:100` | Lazily selects or starts clients per `(server, root)` pair. |
| `runCodegraph` | function | `codegraph/index.ts:94` | Executes the external CodeGraph CLI and normalizes output/errors. |
| `callContext7` | function | `context7/index.ts:31` | Performs Context7 HTTP requests with timeout and optional auth. |
| `callApi` | function | `hindsight/index.ts:67` | Calls Hindsight bank endpoints for recall and retention. |
| `callVelox` | function | `web-tools/index.ts:23` | Calls Velox search/fetch endpoints with timeout and optional auth. |
| `run` | function | `skill-state/runner.ts:79` | SKILL.state loop; takes an injected `complete` so it can be driven by a stub. |
| `execute` | function | `skill-state/executor.ts:162` | Executes one repo action; never throws, errors become observations. |
| `merge` | function | `skill-state/state.ts:80` | Atomic `Σ ⊕ ΔΣ` with bound checks and rollback. |
| `render` / `lastFencedJson` | functions | `skill-state/prompt.ts:32`, `:65` | Single-message prompt; parses the last fenced JSON block. |
| `validateStepResponse` | function | `skill-state/schemas.ts:93` | TypeBox validation returning error paths that name offending keys. |
| `loadSpec` | function | `skill-state/workflow.ts:35` | Built-in spec or `--skill` file, ≤ 4 KB. |
| `saveCheckpoint` / `listCheckpoints` | functions | `skill-state/checkpoints.ts` | Per-cwd durable checkpoint files under the Pi agent dir. |
| `stateRunTool` / `runStateRunTool` | functions | `skill-state/tool-registry.ts` | globalThis registry of sibling read-only tools; vocabulary, validation and execution for the `tool` action. |
| `openRunLog` | function | `skill-state/runlog.ts` | Per-run JSONL trace (prompts, replies, rejections, states, observations) next to the checkpoints; `tools/runlog.ts` reads it. |
| `spawnPane` / `listPanes` / `killPane` | functions | `subagents/tmux.ts` | tmux adapter over an injected `pi.exec`; session per root, first subagent is the first pane, tiled layout. |
| `registerChild` | function | `subagents/child.ts` | Child-role hooks: result + status per settled turn, inbox poll, single fallback-model switch. |
| `resolveType` / `resolveSkills` | functions | `subagents/types.ts` | Built-in type merged with `~/.pi/agent/subagents/<type>.md`; skill names → `--skill` paths. |
| `listTree` / `updateTask` | functions | `subagents/state.ts` | File-per-task registry under the Pi agent dir, atomic writes, launch-tree helpers. |

## CONVENTIONS
- Keep one directory per plugin under ``; use `index.ts` as the loader entry point and add a sibling README for a plugin contract.
- Keep the default export a pi extension factory. Register tools/events through the provided `ExtensionAPI`; do not introduce a separate application entry point.
- Runtime imports must resolve from pi's dependency tree (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai/compat`, `@earendil-works/pi-tui`, `typebox`) or Node built-ins. Plugins intentionally ship no `node_modules`.
- Sibling imports omit the `.ts` extension (`from "./client"`); `allowImportingTsExtensions` is not enabled.
- Read-only tools are registered as `pi.registerTool(stateRunTool({ ... }))` (`skill-state/tool-registry.ts`) so `/state-run` can call them; never wrap a tool that writes.
- The installed `pi` binary may lag `node_modules` types (0.83.0 vs 0.84.2 at last check). Use APIs present in both; e.g. resolve auth with `ctx.modelRegistry.getApiKeyAndHeaders` and call `complete` from `@earendil-works/pi-ai/compat`, not `ctx.modelRegistry.complete`.
- Use strict TypeScript with ES2022, ESNext, bundler resolution, and no emitted files. Match the existing direct string-concatenation style and typed TypeBox schemas when editing adjacent code.
- External API clients use environment-selected base URLs, optional bearer tokens, `AbortSignal` cancellation/timeouts, and readable tool errors that preserve HTTP status in `details.status` where applicable.
- Keep tool output model-ready: concise text plus small structured `details`; cap large external responses before returning them.

## ANTI-PATTERNS (THIS PROJECT)
- Do not add a build step: pi loads TypeScript directly through jiti; `bun run check` is typechecking only.
- Do not add per-plugin package manifests or dependencies unless the pi package model changes deliberately.
- Do not let the model initialize, index, or sync a CodeGraph project, and do not block `session_start` on indexing. The only indexing is the extension's background auto-init of an unindexed git repo (opt out with `CODEGRAPH_AUTO_INIT=0`); without a CLI it must fall back normally.
- Do not auto-install external binaries or restart failed language servers; LSP server availability is environment-owned and failures remain bounded to the session.
- Do not surface optional memory-ingestion failures as session errors; Hindsight retention is fire-and-forget.
- Do not expose secrets in tool output or commit API tokens/configuration.

## UNIQUE STYLES
- CodeGraph tools register at `session_start` when both a resolvable CLI and an ancestor `.codegraph/` index exist, or once a detached background `codegraph init` of the git root finishes (which also adds `.codegraph` to `.git/info/exclude`); default tools are `explore,node`, with others opt-in through `CODEGRAPH_TOOLS`. A `tool_call` hook blocks the session's first bash `grep`/`rg`/`git grep` once, until any `codegraph_*` tool has run.
- Hindsight derives a bank per git project, skips extension inputs/slash commands/trivial prompts, and stores only user prompts plus the final assistant response.
- LSP starts one stdio client per `(server, root)` lazily on first matching file touch; automatic edit/write feedback reports only severity-1 diagnostics, capped at 20 per file.
- Web-tools and Context7 are thin HTTP adapters. Their README files are the source of truth for endpoint contracts and exposed parameters.
- TTS and STT are user-invoked only (`/speak` + `ctrl+alt+s`, `/dictate` + `ctrl+alt+d`) and expose no model-facing tool.
- notify is fully passive: no tool, command, or shortcut — it listens for `agent_settled`/`session_start`, classifies the last assistant reply from `stopReason` plus a trailing `?`, dedupes by message id, and downgrades a missing/failing `NOTIFY_COMMAND` binary to one `ctx.ui.notify` warning per session.
- Skill-state runs its own model loop outside the Pi conversation: telemetry goes to `appendEntry` custom entries (`skill-state-step`, `skill-state-run`, never in LLM context) and one ≤ 1 KB `skill-state-result` message is queued with `deliverAs: "nextTurn"`. One run at a time; `/state-cancel` and `session_shutdown` abort it. Failed/cancelled runs persist a `skill-state-checkpoint` entry and a file under `~/.pi/agent/skill-state/<cwd>/<runId>.json` (`checkpoints.ts`); `/state-resume [--list] [--run id] [--max-steps N] [note]` continues from it with the current model (`launch()` in `index.ts` is shared by both commands). Pi only flushes a session file once it has an assistant message, which is why the file store exists. Model calls send no `reasoning` option on purpose, and no `temperature` unless `SKILL_STATE_TEMPERATURE` is set: some Velox upstreams (e.g. `gandalf`) reject the parameter with HTTP 400. `search_files` uses `git grep --untracked` so gitignored logs/build output never reach the model; `grep -r` only outside a git work tree.
- Subagents are separate interactive `pi` processes in tmux panes, never in-process agent loops. One extension, two roles: every process gets the launcher tools and `/subagents`; a process with `PI_SUBAGENT_TASK` set also runs `registerChild`. Processes talk only through files under `~/.pi/agent/subagents/<cwd>/<root>/tasks/` (one JSON per task, written by launcher → child → closer in that order, so no locks), polled every 1.5 s. A finished child turn becomes one `subagent-result` message sent with `deliverAs: "steer", triggerTurn: true`, so the launcher is interrupted between tool calls rather than waiting for the user (contrast skill-state's `nextTurn`). All descendants of a root share tmux session `pi-<root id8>`; `session_shutdown` closes a process's own subtree and the root kills the empty tmux session. The launcher adds `-e <own index.ts>` to the child only when the extension was loaded from outside `~/.pi/agent` and `.pi/extensions`, because Pi dedupes extension paths by string and would otherwise register everything twice. Fallback models are handled inside the child (`pi.setModel` once after a provider error), never by relaunching.

## COMMANDS
```bash
bun install
bun run check
```

## NOTES
- There is no test suite, CI workflow, formatter, or linter configuration in the repository; do not claim broader validation than `bun run check`. Behavioural checks for skill-state were ad-hoc `bun` scripts in a scratch directory, not committed.
- To exercise an extension without the TUI: `pi --no-session -ne -nc -ns -np -e <plugin>/index.ts --mode json -p "/command args"`. Extension slash commands are dispatched in print mode, but `ui.notify` output is not rendered there; read `entry_appended` events instead.
- `bun.lock` is intentionally ignored by the current repository configuration; preserve that policy unless explicitly changing dependency management.
- `.omc/` and `.omo/` are ignored agent state. `.agents/plans/` is tracked documentation. `.codegraph` may be a local index link and is excluded by the repository's local git info exclude.
