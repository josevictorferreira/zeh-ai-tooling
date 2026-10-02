# 0001 — Init project structure

## Goal

Make `zeh-ai-tooling` the single home for all AI tooling, replacing three places:

| Today | What lives there |
| --- | --- |
| `~/.config/nix/modules/ai-tools/` + `lib/ai-tools.nix` (~900 LOC) | Skills, agents, commands, MCP servers, base rules and scripts, all written as Nix attrsets, plus the renderers that turn them into each harness's file format |
| `~/.config/nix/modules/programs/{claudecode,opencode,pi,gemini,command-code,rtk,hermes-agent,lsp-mcp}` | Install and config for each coding agent (wrappers, settings, providers, opencode plugins, the claude router and statusline) |
| `../my-pi-agent-plugins` | Pi extensions in TypeScript (codegraph, context7, hindsight, lsp, notify, skill-state, stt, subagents, tts, web-tools) |
| `../my-claude-plugins` | Claude Code marketplace with the `voice` plugin |

The end state:

- Skills, agents, commands and rules are **Markdown files with frontmatter**. Nix reads and parses them at eval time and renders them for each harness.
- This repo is a **flake** that exports NixOS and Darwin modules. `~/.config/nix` adds it as an input, imports one module and sets a few enables. Everything AI-related leaves that repo.
- Adding a new skill, agent, command, MCP server, harness or plugin means **adding a directory or file**. No registry file needs editing.

## Vocabulary (used for directory names)

The word "agent" means two different things here, so the layout keeps them apart:

- **harness**: a coding-agent program we install and configure (claude-code, opencode, pi, gemini, command-code, hermes-agent).
- **agent**: a persona or subagent *definition* (architect, code-reviewer, …). This is catalog content.
- **catalog**: content that does not depend on any harness (skills, agents, commands, rules, MCP servers). It is written once and rendered for every harness.
- **plugin**: code native to one harness (Pi extensions, Claude Code plugins, opencode plugins). It cannot be rendered for other harnesses.

## Folder structure

```
zeh-ai-tooling/
├── flake.nix                     # flake-parts + import-tree, same style as ~/.config/nix
├── flake.lock
├── AGENTS.md                     # repo conventions for agents working here (CLAUDE.md → symlink)
├── README.md
│
├── catalog/                      # ★ harness-agnostic content. Markdown is the source of truth
│   ├── skills/
│   │   └── <category>/
│   │       └── <skill-name>/     # one Agent Skills dir, copied as-is to every harness
│   │           ├── SKILL.md      # frontmatter + body
│   │           ├── skill.nix     # OPTIONAL: Nix-only extras (packages, MCP, @placeholders@, built files)
│   │           ├── references/
│   │           ├── scripts/
│   │           └── assets/
│   ├── agents/
│   │   └── <category>/<agent-name>.md
│   ├── commands/
│   │   └── <category>/<command-name>.md
│   ├── rules/
│   │   └── <rule-name>.md        # base.md → AGENTS.md / CLAUDE.md / GEMINI.md for each harness
│   └── mcp/
│       └── <server-name>.nix     # MCP servers stay in Nix (they need wrappers, secrets, store paths)
│
├── harnesses/                    # one dir per coding agent: install + settings + render rules
│   ├── claude-code/
│   │   ├── default.nix           # flake-parts aspect: options, package or wrapper, file tree
│   │   ├── options.nix
│   │   ├── render.nix            # catalog item → ~/.claude/{skills,agents,commands}/…
│   │   ├── settings/             # settings.nix, router.nix, statusline.nix, …
│   │   └── _/                    # private helpers (import-tree skips paths containing /_)
│   ├── opencode/
│   │   ├── default.nix  options.nix  render.nix
│   │   ├── settings/             # formatter, lsp, permission, plugins, provider (from config/)
│   │   └── _/wrapper.nix
│   ├── pi/
│   ├── gemini/
│   ├── command-code/
│   └── hermes-agent/
│
├── plugins/                      # harness-native code (cannot be rendered for other harnesses)
│   ├── claude-code/              # Claude Code marketplace
│   │   ├── .claude-plugin/marketplace.json
│   │   └── voice/                # ← ../my-claude-plugins/plugins/voice (history kept)
│   ├── pi/                       # pi package
│   │   ├── package.json          # "pi": { "extensions": ["./"] }, typecheck deps
│   │   ├── tsconfig.json
│   │   └── <extension>/index.ts  # ← ../my-pi-agent-plugins/extensions/* (history kept)
│   └── opencode/                 # future local opencode plugins (empty with .keep for now)
│
├── packages/                     # standalone tools packaged by this flake (perSystem packages)
│   ├── rtk/                      # RTK build (from programs/rtk)
│   ├── lsp-mcp/
│   └── ai-scripts/               # prompt-enhancer, rules-enforcer (from ai-tools/scripts.nix)
│
├── nix/                          # the plumbing. Content authors never need to open it
│   ├── lib/
│   │   ├── default.nix           # exported as `lib` flake output
│   │   ├── frontmatter.nix       # split "---" block, parse YAML subset → attrset
│   │   ├── catalog.nix           # walk catalog/ → { skills, agents, commands, rules, mcp }
│   │   ├── render/               # shared renderers moved out of lib/ai-tools.nix
│   │   │   ├── markdown.nix      # attrset → frontmatter + body
│   │   │   ├── toml.nix          # gemini commands
│   │   │   └── json.nix
│   │   └── files.nix             # file tree → linkFarm derivation
│   └── modules/
│       ├── catalog.nix           # zeh.ai.{skills,agents,commands,mcp}.<name>.{enable,harnesses}
│       ├── harnesses.nix         # zeh.ai.harnesses.<h>.{enable,files} common interface
│       └── default.nix           # the one module consumers import (pulls in everything)
│
├── tests/                        # run by `nix flake check`
│   ├── frontmatter/              # parser fixtures: input .md + expected .json
│   ├── render/                   # snapshot tests per harness
│   └── catalog.nix               # invariants: unique names, required fields, name == dir name
│
└── .agents/
    ├── specs/NNNN-<slug>/        # plan.md, tasks.md, … (this file)
    └── skills/                   # skills for agents working ON this repo (not installed)
```

### Why this shape grows cleanly

- **One axis per top-level dir.** `catalog/` is *what* we give the agents. `harnesses/` is *who* receives it. `plugins/` holds code tied to one harness. `packages/` holds standalone binaries. `nix/` is the machinery. A new artifact fits exactly one of these.
- **Auto-discovery everywhere.** `catalog.nix` walks the directories and import-tree picks up every `harnesses/*/default.nix`. Adding an item is just a file. This replaces the hand-maintained lists in `skills.nix`, `agents.nix` and `commands.nix`, and the `piExtensionDirs` readDir in `roles/ai-development.nix`.
- **Categories are folders, names are global.** `<category>/` keeps directories browsable as the catalog grows. Harnesses install into a flat namespace, so `tests/catalog.nix` fails the check when two items share a name.
- **Skills are self-contained directories.** A skill dir is a valid Agent Skills package even without Nix (you can copy it anywhere). Nix-specific glue lives in an optional `skill.nix` beside it, so the Markdown stays clean.
- **Harness quirks stay inside the harness.** How pi turns commands into prompt templates, or how gemini needs TOML, lives in `harnesses/<h>/render.nix`. Adding a harness is one new dir and never touches the catalog.

## Content format

### Frontmatter parsing (decided: YAML, the Claude Code standard)

Claude Code (skills, subagents, slash commands, plugins) uses YAML frontmatter between `---` lines. opencode and the Agent Skills spec use the same format, so the catalog uses it too.


Nix has `builtins.fromJSON` and `builtins.fromTOML` but no YAML parser. These were the ways to read it:

| Option | Pros | Cons |
| --- | --- | --- |
| **A. YAML frontmatter, pure-Nix parser for a documented subset** *(chosen)* | Standard format (Agent Skills, Claude, opencode all use `---` YAML); skill dirs stay portable; no IFD; fast eval | ~100 LOC parser to maintain; only a subset is supported (scalars, quoted strings, block/flow lists of scalars, nested maps up to 2 levels, `>`/`|` blocks); anything else gets a hard eval error |
| B. TOML frontmatter (`+++`) via `builtins.fromTOML` | Zero parser code, full fidelity, typed | Non-standard: skills would no longer be portable as-is, and editors and linters expect YAML |
| C. YAML via IFD (one `yq` derivation converts the whole catalog to JSON) | Full YAML | Import-from-derivation: slower evals on both hosts, breaks `nix flake show`, cross-platform builds |

The frontmatter we actually use (name, description, license, allowed-tools, metadata, model, temperature, tools, permission) fits the subset in option A. `tests/frontmatter/` pins the parser's behavior.

### Skill: `catalog/skills/<category>/<name>/SKILL.md`

```markdown
---
name: browser-dev-cycle            # must equal the directory name (checked)
description: Full development cycle browser automation …
license: MIT
allowed-tools: [Read, Grep, Bash]
harnesses: [opencode, claude-code]  # optional; default = every enabled harness
metadata:
  triggers: browser, debug, …
---
# Browser Dev Cycle

Run `node @playwrightHelper@ …`
```

Optional `skill.nix`. It is a function and gets the same arguments the current skill files receive:

```nix
{ pkgs, lib, ... }:
{
  packages = [ pkgs.playwright pkgs.nodejs ];            # put on PATH via the harness wrappers
  substitutions."@playwrightHelper@" = "${helper}";      # replaced in SKILL.md and references/*.md
  files."scripts/playwright-helper.mjs" = helper;        # overrides or adds files in the installed dir
  mcp.playwright = { command = …; args = [ ]; };         # MCP servers this skill brings
  transform = text: text;                                # escape hatch for vendored upstream skills
}
```

`@name@` placeholders follow the nixpkgs `substitute` convention. They replace the current `builtins.replaceStrings [ "from 'playwright-core';" ] …` hacks, except in vendored skills like `ultimate-browsing`, which keep using `transform` so their files stay diffable against upstream.

### Agent: `catalog/agents/<category>/<name>.md`

```markdown
---
name: architect
description: Systems architect specialist for …
mode: primary
tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch, WebSearch]
overrides:                          # per-harness extras, merged over the top level
  opencode: { temperature: 0.2 }
  claude-code: { model: opus }
---
# Architect
…
```

### Command: `catalog/commands/<category>/<name>.md`

```markdown
---
name: commit-changes
description: Systematically analyze, group, and commit changes …
agent: ""                            # optional
---
# Commit Changes
… $ARGUMENTS …
```

### Rule: `catalog/rules/base.md`

Plain Markdown with no frontmatter needed. It is concatenated into each harness's global context file.

### MCP: `catalog/mcp/<name>.nix`

Stays in Nix: every server today needs a wrapper script, a secret read or a store path. Same shape as the current `mkMcpModule` input, one file per server (context7, chrome-devtools, jira, grafana, grafana-work).

## Nix architecture

```
catalog/**  ──nix/lib/catalog.nix──▶  normalized attrsets  ──nix/modules/catalog.nix──▶  zeh.ai.<kind>.<name>
                                                                                            │ enable / harnesses
                                                                                            ▼
                                          harnesses/<h>/render.nix  ◀──  zeh.ai.harnesses.<h>
                                                     │
                                                     ▼
                                     zeh.ai.harnesses.<h>.files  (relative path → derivation)
                                                     │
                     ~/.config/nix glue: mapAttrs into jvf.home.<user>.files (≈10 lines)
```

- **Option namespace `zeh.ai.*`** (decided). It replaces `jvf.aiTools.*` and `jvf.programs.<harness>.*`. This repo then has no dependency on `jvf.core` or `jvf.home`. Each harness module exposes its rendered tree as `zeh.ai.harnesses.<h>.files` plus `packages`. The consumer decides how files reach `$HOME`, with a small glue module in `~/.config/nix`.
- **NixOS and Darwin modules** come out of one function with `isDarwin`, like the existing dendritic aspects. Outputs are `flake.modules.nixos.default` and `flake.modules.darwin.default`, plus per-harness modules for picking a subset.
- **`lib.aiTools` → `inputs.zeh-ai-tooling.lib`.** The pure helpers (frontmatter, render, catalog) are exported for reuse and tests.
- **Packages** (`rtk`, `lsp-mcp`, `ai-scripts`, plus a `pi-extensions` and a `claude-plugins` derivation built from `plugins/`) go under `perSystem.packages`.
- **Plugins install from the store**, not from GitHub at runtime:
  - Pi: `plugins/pi/*/` → `~/.pi/agent/extensions/<name>/`. This keeps the auto-discovery that `piExtensionDirs` does today.
  - Claude Code: register `plugins/claude-code` as a local `directory` marketplace through `settings.extraKnownMarketplaces`. This replaces the `PLUGINS_SENTINEL` + `claude plugin marketplace add josevictorferreira/my-claude-plugins` bootstrap for our own plugins (oh-my-claudecode stays as a third-party marketplace).

### Consumer side (`~/.config/nix`)

```nix
# flake.nix
inputs.zeh-ai-tooling.url = "github:josevictorferreira/zeh-ai-tooling";
inputs.zeh-ai-tooling.inputs.nixpkgs.follows = "nixpkgs";
# remove: pi-plugins

# modules/roles/ai-development.nix (shrinks to enables + glue)
imports = [ inputs.zeh-ai-tooling.modules.nixos.default ];
zeh.ai = {
  harnesses = { claude-code.enable = true; opencode.enable = true; pi.enable = true; gemini.enable = true; };
  mcp = { chrome-devtools.enable = true; jira.enable = true; };
  harnesses.claude-code.settings.permissions.defaultMode = "bypassPermissions";
};
```

Deleted from `~/.config/nix`: `modules/ai-tools/`, `lib/ai-tools.nix` (and its `lib/default.nix` export), `modules/programs/{claudecode,opencode,pi,gemini,command-code,rtk,hermes-agent,lsp-mcp}`. Secrets (`modules/secrets/environment.nix`) **stay** in `~/.config/nix`. Harness modules read env vars or `/run/secrets/*` paths passed in as options, and never sops files directly.

## Migration plan

Each phase ends in a green, verifiable state. The strongest check is in phase 4: **the rendered home trees must be byte-identical before and after**, except for changes we list on purpose.

0. **Baseline snapshot.** In `~/.config/nix`, build the current rendered trees (`.claude`, `.config/opencode`, `.pi/agent`, `.gemini`, command-code) for `zeh-pc` and `zeh-mac` and save the store paths.
   → verify: paths recorded in `.agents/specs/0001-init-project-structure/baseline.md`.
1. **Scaffold.** Create `flake.nix` (flake-parts, import-tree, nixpkgs), `nix/lib/{frontmatter,catalog,files}.nix`, `tests/`, and empty `catalog/`, `harnesses/`, `plugins/` and `packages/` with `.keep` files.
   → verify: `nix flake check` passes, including the frontmatter fixtures.
2. **Import plugin repos with history.** `git filter-repo --to-subdirectory-filter plugins/pi` on a clone of `my-pi-agent-plugins`, then merge with `--allow-unrelated-histories`. Do the same for `my-claude-plugins` → `plugins/claude-code`. Move the marketplace.json into place and update its `source` paths. Drop `my-pi-agent-plugins/.agents/` into `.agents/specs/legacy-pi/` (or keep it per plugin; decide during the move).
   → verify: `git log --follow plugins/pi/lsp/index.ts` shows the old history; `npm run check` in `plugins/pi`; `claude plugin validate plugins/claude-code`.
3. **Convert the catalog.** A one-off script (in scratch, not committed) evaluates each existing `.nix` skill, agent and command and writes `.md` + frontmatter. Skills that already have `_body.md` move with their `references/` and `scripts/`. Nix-computed bits become a `skill.nix`. Move `rules.nix` content to `catalog/rules/base.md`, and `mcp.nix` servers to `catalog/mcp/*.nix`.
   → verify: `tests/catalog.nix` passes, and the item count equals the old count (14 agents, 34 commands, 17 enabled skills, 5 MCP servers).
4. **Move harnesses + renderers.** Port `lib/ai-tools.nix` renderers into `nix/lib/render/` and `harnesses/*/render.nix`, and port the `programs/*` modules into `harnesses/*` under `zeh.ai.*`.
   → verify: point `~/.config/nix` at the local checkout (`--override-input zeh-ai-tooling ~/Workspace/zeh-ai-tooling`), build both hosts, and `diff -r` every rendered tree against the phase 0 baseline. No diff except the listed intentional changes.
5. **Switch the consumer.** Add the flake input in `~/.config/nix`, shrink `roles/ai-development.nix`, delete the old modules, remove the `pi-plugins` input, and update `modules/ai-tools/AGENTS.md` references.
   → verify: `nixos-rebuild build` on zeh-pc, `darwin-rebuild build` on zeh-mac, then switch; smoke-test `claude`, `opencode`, `pi` and `gemini`. Each should list the skills, run a command and load an extension.
6. **Archive the old repos.** Add a README pointer and archive `my-pi-agent-plugins` and `my-claude-plugins` on GitHub.

Phases 1–4 touch only this repo. `~/.config/nix` changes only in phase 5.

## Decisions

| # | Question | Decision |
| --- | --- | --- |
| 1 | Frontmatter format | YAML between `---` lines (Claude Code standard), read by a pure-Nix subset parser (option A) |
| 2 | Option namespace | New `zeh.ai.*`, decoupled from `jvf.home` through a `files` output |
| 3 | Do `rtk`, `hermes-agent` and `lsp-mcp` move here? | Yes: `rtk` and `lsp-mcp` → `packages/` + harness wiring, `hermes-agent` → `harnesses/` |
| 4 | Keep `pi install git:…` / `/plugin marketplace add <repo>` working? | No. Nix is the only install path and the old repos go unmaintained. No root `package.json` or root `.claude-plugin/`: manifests live under `plugins/<h>/`. Pi extensions are copied from the store into `~/.pi/agent/extensions/`. The Claude marketplace is registered as a local `directory` source via `extraKnownMarketplaces`. The archived repos' READMEs point here |
| 5 | Name of the content dir | `catalog/` |
| 6 | Git history of the two plugin repos | Kept via `git filter-repo` (phase 2) |
| 7 | Disabled items | Drop `browser-debug-tools` (superseded by `browser-dev-cycle`) and `openclaw-nix-upgrade` (commented out, file missing) |

## As built (2026-10-02)

Phases 0–5 are done. Phase 6 (archive the old GitHub repos) and the first
push of this repo are left for you; see "Remaining steps".

### Deviations from the structure above

| Planned | Built | Why |
| --- | --- | --- |
| import-tree over the repo | `nix/modules/default.nix` reads `harnesses/*/default.nix` and `packages/*/module.nix` | harness dirs hold non-module files (`options.nix`, `settings/*.nix`); a plain `readDir` needs no `_/` convention |
| `harnesses/<h>/render.nix`, `nix/lib/render/{markdown,toml,json}.nix` | one shared `nix/lib/render.nix`; renderers only one harness uses (pi prompt templates, command-code agents) stay in that harness's `default.nix` | they were already that small |
| `harnesses/<h>/_/` | `harnesses/<h>/settings/` (claude router, opencode formatter/lsp/permission/plugins/provider), `wrapper.nix`, `provider.nix` | no `_/` needed without import-tree |
| `nix/modules/harnesses.nix` with a `files` interface | `nix/modules/core.nix`: `zeh.ai.{username,homeDirectory,home,wrappers,secrets}` | harnesses need `kind`/`mode`/`preserve`/`postInstall`, so the output is jvf.home-shaped items, not a flat file map |
| `packages/ai-scripts/` | `packages/<name>/{package.nix,module.nix}` for `rtk`, `prompt-enhancer`, `rules-enforcer`; `packages/lsp-mcp/module.nix` (config only) | one tool per dir; `zeh.ai.tools.<name>.enable` |
| `@placeholder@` tokens in Markdown | `skill.nix` `substitutions` are arbitrary from → to pairs (e.g. `from 'playwright-core';` → the store path) | the Markdown keeps its upstream, Nix-free text |
| `plugins/opencode/` | not created | no local opencode plugins yet; the opencode npm plugin list stays in `harnesses/opencode/settings/plugins.nix` |
| `plugins/pi/package.json` stays a pi package | typecheck-only `package.json` | decision 4: Nix is the only install path |

### Intentional output changes (everything else is byte-identical)

The rendered home trees were diffed against the phase 0 baseline, with store
hashes normalized: `.claude`, `.config/opencode`, `.pi/agent`, `.gemini`,
`.commandcode`, every other `jvf.home` item, and the wrapper scripts and the
ultimate-browsing runtime. All match, except:

1. `skills/xlsx/LICENSE.txt` is now shipped (vendored skill's license).
2. `skills/ultimate-browsing/scripts/engine/AGENTS.md` is now shipped (rule: every file in a skill dir ships).
3. Claude Code plugins: marketplace `my-claude-plugins` (GitHub) → `zeh-ai-tooling`
   (local `directory` source at `~/.local/share/zeh-ai-tooling/claude-plugins`,
   a new `link` home item into the store). `enabledPlugins` has
   `voice@zeh-ai-tooling`. The `claude` wrapper's one-time bootstrap moved to
   sentinel `v5`: it runs `marketplace add <that path>` + `plugin install voice@zeh-ai-tooling`.
   Checked in an isolated `CLAUDE_CONFIG_DIR`: `claude plugin validate` passes,
   and add + install + list show `voice@zeh-ai-tooling ✔ enabled`.

### Verification

- `nix flake check` here: frontmatter fixtures, render snapshots (oracle: the
  old `lib/ai-tools.nix` renderers), whole-catalog load, and a NixOS module
  evaluation with every harness and tool enabled.
- Catalog round-trip: every loaded skill, agent and command definition equals
  the old evaluated Nix definition (17 skills, 14 agents, 34 commands, 2 rules,
  5 MCP servers).
- Consumer: zeh-pc built (`nixos-system-zeh-pc`); zeh-mac evaluated (drv only,
  no darwin builder here). Items, kinds, modes, preserve lists, postInstall
  scripts, wrappers and package names are identical on both hosts.
- `plugins/pi`: `bun run check` reports one error in
  `skill-state/tool-registry.ts`. The old repo reports the same error against
  the current `@earendil-works/pi-coding-agent@latest`, so the move did not cause it.

### Remaining steps (outward-facing, not done)

1. Create `github.com/josevictorferreira/zeh-ai-tooling` and push `main`.
2. In `~/.config/nix/flake.nix`, switch `zeh-ai-tooling.url` from
   `git+file:///home/josevictor/Workspace/zeh-ai-tooling` to
   `github:josevictorferreira/zeh-ai-tooling`, then `nix flake update zeh-ai-tooling`.
   zeh-mac needs this, because it has no local checkout at that path.
3. `nixos-rebuild switch` on zeh-pc; `darwin-rebuild switch` on zeh-mac.
4. Archive `my-pi-agent-plugins` and `my-claude-plugins` with a README pointer here.
