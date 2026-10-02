# Claude Code options definitions
{ lib
, pkgs
, ...
}:
let
  json = pkgs.formats.json { };
in
{
  options.zeh.ai.harnesses.claude-code = {
    enable = lib.mkEnableOption "Claude Code";

    contextFile = lib.mkOption {
      type = lib.types.str;
      default = "CLAUDE.md";
      description = "Name of the global context file the base rules are written to.";
    };
    baseRules = lib.mkOption {
      type = lib.types.str;
      default = "";
      description = "A set of base rules to apply to the Claude configuration.";
    };
    agents = lib.mkOption {
      type = lib.types.attrsOf (lib.types.either lib.types.str json.type);
      default = { };
      description = "Agents to install into the configuration (string prompts or structured objects)";
    };
    commands = lib.mkOption {
      type = lib.types.attrsOf (lib.types.either lib.types.str json.type);
      default = { };
      description = "Commands to install into the configuration (string prompts or structured objects)";
    };
    mcps = lib.mkOption {
      type = lib.types.attrsOf json.type;
      default = { };
      description = "MCP tools to install into the configuration (structured objects)";
    };
    skills = lib.mkOption {
      type = lib.types.attrsOf (lib.types.either lib.types.str json.type);
      default = { };
      description = "Skills to install into the configuration";
    };
    settings = lib.mkOption {
      inherit (json) type;
      default = { };
      description = "ClaudeCode settings.";
    };
    routerSettings = lib.mkOption {
      inherit (json) type;
      default = { };
      description = "Settings written to ~/.claude-code-router/config.json";
    };
    theme = lib.mkOption {
      type = lib.types.enum [ "default" "tokyonight" ];
      default = "default";
      description = "Preset theme for the Claude Code statusline.";
    };
    statusline = lib.mkOption {
      type = (pkgs.formats.toml { }).type;
      default = { };
      description = "Custom statusline configuration for Claude Code (TOML). Merged with preset if theme is not 'default'.";
    };
  };
}
