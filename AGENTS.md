# AGENTS.md

Monorepo for all AI tooling, consumed as a flake by `~/.config/nix`. Start with
[README.md](README.md) for the layout and the option surface.

## Where things go

| Change | Location |
| --- | --- |
| Skill / agent / command / rule content | `catalog/` (Markdown + YAML frontmatter) |
| Something a skill needs from Nix (store paths, MCP, wrappers) | `catalog/skills/<category>/<name>/skill.nix` |
| MCP server | `catalog/mcp/<name>.nix` (`_*.nix` = shared helper) |
| How a harness installs, configures or renders | `harnesses/<harness>/` |
| Pi extension / Claude Code plugin code | `plugins/pi/<name>/`, `plugins/claude-code/<name>/` (each has its own AGENTS.md / README.md) |
| Standalone tool | `packages/<name>/package.nix` (+ `module.nix`) |
| Parser, loader, renderers | `nix/lib/` |
| `zeh.ai.*` option plumbing | `nix/modules/` |
| Design history | `.agents/specs/NNNN-<slug>/` |

## Rules

- Markdown is the source of truth for catalog content. Do not add Nix
  attrsets for skills, agents or commands; put only what needs Nix in `skill.nix`.
- Frontmatter must stay inside the subset `nix/lib/yaml.nix` parses (see
  README "Frontmatter"). Quote any string containing `: `, ` #`, `,` or a leading
  special character. A parse error names the line.
- Item names are global: a frontmatter `name` must equal its file or directory
  name, and no two categories may reuse a name.
- Modules here never write to `$HOME` or set consumer options (`jvf.*`). Output
  goes through `zeh.ai.home`, `zeh.ai.wrappers` and `users.users.<user>.packages`.
- Gate a harness's outputs with `lib.mkIf cfg.enable`. Leave option defaults and
  settings that other modules read (e.g. opencode providers, which pi
  translates) ungated.
- Changing a renderer changes every installed file: update `tests/render/`
  snapshots on purpose, never to make a failure go away.

## Verify

```sh
git add -A && nix flake check      # flakes only see tracked files
```

For a change that affects the installed output, build the consumer against this
checkout and diff the rendered trees:

```sh
cd ~/.config/nix
nix build .#nixosConfigurations.zeh-pc.config.system.build.toplevel \
  --override-input zeh-ai-tooling ~/Workspace/zeh-ai-tooling
```
