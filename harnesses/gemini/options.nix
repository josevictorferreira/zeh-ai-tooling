# Gemini CLI options definitions
{ lib
, pkgs
, ...
}:
let
  json = pkgs.formats.json { };
in
{
  options.zeh.ai.harnesses.gemini = {
    enable = lib.mkEnableOption "Gemini CLI";

    contextFile = lib.mkOption {
      type = lib.types.str;
      default = "GEMINI.md";
      description = "Name of the global context file the base rules are written to.";
    };

    baseRules = lib.mkOption {
      type = lib.types.str;
      default = "";
      description = "A set of base rules to apply to the Gemini configuration";
    };

    agents = lib.mkOption {
      type = lib.types.attrsOf (lib.types.either lib.types.str json.type);
      default = { };
      description = "Agents to install as commands (Gemini CLI doesn't have native agents, so they become commands)";
    };

    skills = lib.mkOption {
      type = lib.types.attrsOf (lib.types.either lib.types.str json.type);
      default = { };
      description = "Skills to install into the configuration (string prompts or structured objects)";
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

    settings = lib.mkOption {
      inherit (json) type;
      default = { };
      description = "Settings written to ~/.gemini/settings.json";
    };
  };
}
