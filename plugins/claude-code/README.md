# Claude Code plugins

Custom [Claude Code](https://code.claude.com) plugins. This directory is a
plugin marketplace named `zeh-ai-tooling`. Formerly the `my-claude-plugins`
repo; its history lives on here.

## Plugins

| Plugin | Description |
| --- | --- |
| [voice](voice/) | `/speak` reads the last agent reply aloud, `/dictate` transcribes your microphone to the clipboard — both through [Velox](https://velox.josevictor.me) |

## Install

Installed by Nix: the `claude-code` harness
([`harnesses/claude-code`](../../harnesses/claude-code/default.nix)) registers
this directory, from the Nix store, as a local `directory` marketplace in
`~/.claude/settings.json` (`extraKnownMarketplaces`) and enables every plugin
listed in `.claude-plugin/marketplace.json`. Local directory marketplaces are
read in place, so a rebuild is all it takes to ship a change.

## Development

```sh
claude plugin validate plugins/claude-code
claude --plugin-dir plugins/claude-code/voice   # try a plugin without installing it
```

## Layout

```
.claude-plugin/marketplace.json   one entry per plugin
<name>/
├── .claude-plugin/plugin.json    manifest
├── commands/*.md                 slash commands
├── hooks/hooks.json              event hooks
├── scripts/                      implementation
└── README.md                     tools, configuration, caveats
```

## Conventions

- One directory per plugin, listed in `.claude-plugin/marketplace.json`.
- Scripts run on Node with no dependencies — Claude Code ships its own Node, and
  a plugin that needs `npm install` is not worth the install friction.
- Reference the plugin's own files through `$CLAUDE_PLUGIN_ROOT`, never a
  relative or absolute path.
- Each plugin documents its environment variables and the external commands it
  shells out to in its own `README.md`.
