# zeh-ai-tooling

All my AI tooling in one flake: skills, agents, slash commands, rules and MCP
servers (written once, as Markdown), the plugins that only one coding agent
understands, and the Nix modules that install and configure the coding agents
themselves (Claude Code, OpenCode, Pi, Gemini CLI, Command Code, Hermes Agent).

`~/.config/nix` consumes it as a flake input and only says what to enable.

## Layout

```
catalog/        what the agents get — harness-agnostic, Markdown is the source of truth
  skills/<category>/<name>/SKILL.md     Agent Skills dir; every other file in it ships too
  skills/<category>/<name>/skill.nix    optional Nix-only extras (store paths, MCP, wrappers)
  agents/<category>/<name>.md
  commands/<category>/<name>.md
  rules/<name>.md                       concatenated into AGENTS.md / CLAUDE.md / GEMINI.md
  mcp/<name>.nix                        MCP servers (need wrappers and store paths)
harnesses/      who receives it — one dir per coding agent: install, settings, output format
plugins/        code native to one harness
  claude-code/                          Claude Code marketplace (voice, …)
  pi/                                   Pi extensions (codegraph, lsp, hindsight, …)
packages/       standalone tools: <name>/package.nix (+ module.nix to install it)
nix/            plumbing: lib/ (parser, loader, renderers) and modules/ (zeh.ai.* options)
tests/          `nix flake check`
```

Nothing is registered by hand. A new directory under `catalog/`, `harnesses/`,
`plugins/pi/` or `packages/` is picked up on the next rebuild. Names starting
with `_` or `.` are ignored (shared helpers, drafts). Categories are only for
browsing: installed names are flat, so a name used twice fails evaluation.

## Adding things

| To add | Create | Notes |
| --- | --- | --- |
| a skill | `catalog/skills/<category>/<name>/SKILL.md` | add `references/`, `scripts/`, `templates/`, … next to it |
| an agent | `catalog/agents/<category>/<name>.md` | |
| a command | `catalog/commands/<category>/<name>.md` | `$ARGUMENTS`, `$1` and `` !`cmd` `` are translated for Gemini |
| a rule | `catalog/rules/<name>.md` | rules are joined in file-name order |
| an MCP server | `catalog/mcp/<name>.nix` | `{ harnesses = [ … ]; config = { command; args; … }; }` |
| a Pi extension | `plugins/pi/<name>/index.ts` | |
| a Claude Code plugin | `plugins/claude-code/<name>/` | and an entry in `.claude-plugin/marketplace.json` |
| a coding agent | `harnesses/<name>/default.nix` | declare a `skills` option to receive catalog content |
| a tool | `packages/<name>/package.nix` | plus `module.nix` with `zeh.ai.tools.<name>.enable` |

## Frontmatter

YAML between `---` lines, the format Claude Code uses. Nix has no YAML parser, so
[`nix/lib/yaml.nix`](nix/lib/yaml.nix) reads a subset: block maps at any depth,
lists of scalars (block or `[flow]`), flat `{ flow: maps }`, plain / `"double"` /
`'single'` quoted scalars, booleans, numbers, `null`, and `|` / `>` blocks.
Anything else (anchors, tags, maps inside lists) fails evaluation with the line
number. One blank line after the closing `---` is dropped.

Every item accepts two routing keys, which are stripped before rendering:

```yaml
enable: false                 # default true; zeh.ai.<kind>.<name>.enable overrides
harnesses: [opencode, pi]     # default: every harness (skills with MCP servers: opencode)
```

The rest is passed to the harness renderers. For skills that is `name`,
`description`, `license`, `allowed-tools`, `metadata`, `mcp` and `model`. For
agents it is `name`, `description`, `mode`, `model`, `temperature`, `tools`,
`disabledTools` and `permission`. For commands it is `name`, `description` and
`agent`. The installed `SKILL.md` / agent / command frontmatter is regenerated
for each harness. The source frontmatter is never copied verbatim.

### skill.nix

Optional, for anything that needs Nix (see
[`browser-dev-cycle`](catalog/skills/browser/browser-dev-cycle/skill.nix)):

```nix
{ lib, pkgs, skillDir, ... }:
{
  substitutions."from 'playwright-core';" = "from '${pkgs.playwright}/index.mjs';"; # SKILL.md body
  substituteIn = [ "scripts/helper.mjs" ];                                       # …and these files
  mcp.playwright = { command = …; args = [ ]; };                                 # merged into `mcp`
  wrappers.my-tool = { command = "${drv}/bin/my-tool"; packages = [ … ]; };      # on PATH when enabled
  files."scripts/generated.sh" = "…";                                            # add / override files
}
```

## Using it from a NixOS / nix-darwin config

```nix
# flake.nix
inputs.zeh-ai-tooling.url = "github:josevictorferreira/zeh-ai-tooling";
inputs.zeh-ai-tooling.inputs.nixpkgs.follows = "nixpkgs";

# a module
{ config, inputs, ... }:
{
  imports = [ inputs.zeh-ai-tooling.modules.nixos.default ];   # or modules.darwin.default

  zeh.ai = {
    username = "me";
    harnesses = { claude-code.enable = true; opencode.enable = true; pi.enable = true; };
    tools.rtk.enable = true;
    mcp.jira.enable = true;
    secrets.velox_api_key = config.sops.secrets.velox_api_key.path;
  };
}
```

The modules never write to `$HOME` themselves. They produce:

- `zeh.ai.home`: `{ "<path under $HOME>" = { kind; mode; source | text | json | toml; preserve; postInstall; }; }`
- `zeh.ai.wrappers`: `{ "<program>" = { packages; command?; env?; }; }`
- `users.users.<username>.packages`: plain packages (pi, the prompt scripts)

The consumer maps the first two onto its own home and wrapper machinery. In
`~/.config/nix` that is two lines in `modules/roles/ai-development.nix`:

```nix
jvf.home.users.${username}.items = config.zeh.ai.home;
jvf.wrappers.users.${username}.programs = config.zeh.ai.wrappers;
```

## Options

| Option | |
| --- | --- |
| `zeh.ai.username`, `zeh.ai.homeDirectory` | who receives everything |
| `zeh.ai.harnesses.<h>.enable` | install a coding agent (`claude-code`, `opencode`, `pi`, `gemini`, `command-code`, `hermes-agent`) |
| `zeh.ai.harnesses.<h>.settings` (and harness-specific options) | per-agent settings, merged with the defaults here |
| `zeh.ai.{skills,agents,commands,rules,mcp}.<name>.{enable,harnesses}` | per-item routing |
| `zeh.ai.tools.<name>.enable` | `rtk`, `lsp-mcp`, `prompt-enhancer`, `rules-enforcer` |
| `zeh.ai.secrets.<name>` | secret file paths (only the path lands in the store) |

## Development

```sh
nix flake check                    # parser fixtures, render snapshots, catalog load, module eval
nix fmt                            # nixpkgs-fmt
cd plugins/pi && bun install && bun run check
claude plugin validate plugins/claude-code
```

In the consumer, `--override-input zeh-ai-tooling ~/Workspace/zeh-ai-tooling`
builds against a local checkout without committing.
