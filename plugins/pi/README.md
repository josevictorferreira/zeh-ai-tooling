# Pi extensions

Custom extensions for the [pi coding agent](https://github.com/badlogic/pi-mono). Formerly the `my-pi-agent-plugins` repo; its history lives on in this directory.

## Plugins

| Plugin | Description |
| --- | --- |
| [codegraph](codegraph/) | Semantic code search and exploration over a local [CodeGraph](https://github.com/colbymchenry/codegraph) index: `codegraph_explore` returns symbols' source, call paths and blast radius in one call (requires the `codegraph` CLI) |
| [hindsight](hindsight/) | Per-project long-term memory backed by a [Hindsight](https://github.com/vectorize-io/hindsight) REST API: auto-retains your prompts and final responses, `hindsight_recall` tool for search |
| [context7](extensions/context7/) | Up-to-date library documentation from [Context7](https://context7.com): `context7_resolve_library_id` to find a library, `context7_query_docs` to fetch current docs and code examples |
| [web-tools](web-tools/) | Web search and URL content extraction via the [Velox](https://velox.josevictor.me/docs) proxy: `web_search` and `web_fetch` tools |
| [lsp](lsp/) | Language server integration: compiler errors appended to `edit`/`write` results, plus an `lsp` tool for hover, definitions, references, symbols and diagnostics |
| [notify](notify/) | Desktop notifications when a run settles: one `notify-send`-style popup classifying the last assistant reply as done, question or error (aborts stay silent); `NOTIFY_COMMAND`/`NOTIFY_TITLE`/`NOTIFY_ENABLED` env vars, works in `-p` and the TUI |
| [skill-state](skill-state/) | `/state-run <objective>`: executes a long-horizon SE task with the SKILL.state runtime (arXiv:2608.26263): frozen spec + bounded JSON state + latest observation only, so per-step prompt size is constant and cumulative tokens are linear in steps. `/state-resume` continues a failed run, `/state-log` shows the per-run traces under `~/.pi/agent/skill-state/`, `/state-cancel` aborts |
| [subagents](subagents/) | Delegate to **explorer / researcher / worker / oracle** subagents: each is a separate interactive `pi` in its own tmux pane (session `pi-<id8>`), and every finished turn interrupts the launcher with a `subagent-result` message. Tools `subagent_launch`, `subagent_check`, `subagent_send`, `subagent_close`; `/subagents [--all]` lists the launch tree. Per-type model, fallback model, prompt, tools and skills via `~/.pi/agent/subagents/<type>.md` |


## New Plugins

These are the plugins that I plan to add as tools for my pi agent. 
- Hindsight (Per-project long-term memory backed by a Hindsight REST API)

## Install

Installed by Nix, not by `pi install`: the `pi` harness
([`harnesses/pi`](../../harnesses/pi/default.nix)) copies every
`plugins/pi/<plugin>/` directory that has an `index.ts` into
`~/.pi/agent/extensions/<plugin>/`, which pi auto-loads. Adding a plugin is a
new directory plus a rebuild; `zeh.ai.harnesses.pi.extensionDirs` overrides the
set.

## Development

Extensions are loaded by pi through jiti — TypeScript runs directly, no build
step. Typechecking only:

```sh
bun install
bun run check
```

To try a plugin live, run pi from a project containing a `.pi/extensions/`
entry that re-exports it, e.g.:

```ts
export { default } from "~/Workspace/zeh-ai-tooling/plugins/pi/hindsight/index.ts";
```

## Teaching pi to use these tools

Every tool here ships its own prompt surface, so no extra configuration is needed
for the model to see it:

- `promptSnippet` → one line in the system prompt's `Available tools` list (what exists).
- `promptGuidelines` → bullets in `Guidelines` naming the tool (when to use it, when not,
  and what to prefer instead). Cross-tool preferences are written from the losing side
  (e.g. web_search says "only when context7 has no match") so they stay correct when the
  other extension is not installed.
- `description` / parameter descriptions → the tool schema (how to call it).

`tts` and `stt` are user-invoked (`/speak`, `/dictate`, keybindings) and intentionally
have no model-facing surface.

Cross-tool ordering that spans extensions belongs in your own `~/.pi/agent/AGENTS.md`,
which pi loads into every session. A short block that works well:

```markdown
## Tool Strategy
- Understanding code or a change's impact: codegraph_explore → lsp → grep/read.
- Third-party library API/config/migration: context7_resolve_library_id + context7_query_docs → web_search + web_fetch.
- My preferences, past decisions or earlier sessions: hindsight_recall first, then ask.
- Store durable preferences/decisions with hindsight_retain when stated.
```

## Conventions

- One directory per plugin under `plugins/pi/`, entry point `index.ts` with a
  default-export factory `(pi: ExtensionAPI) => void`.
- Runtime imports must resolve from pi's own dependency tree
  (`@earendil-works/pi-coding-agent`, `typebox`) or node builtins — plugins
  here ship no `node_modules`.
- Each plugin has its own `README.md` documenting tools and configuration.
