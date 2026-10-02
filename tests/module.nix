# Evaluates the NixOS module with every harness and tool enabled and checks
# that the expected home items, wrappers and settings come out.
{ pkgs, lib }:
let
  system = import (pkgs.path + "/nixos/lib/eval-config.nix") {
    inherit (pkgs.stdenv.hostPlatform) system;
    modules = [
      (import ../nix/modules { isDarwin = false; })
      {
        nixpkgs.pkgs = pkgs;
        boot.loader.grub.enable = false;
        fileSystems."/" = {
          device = "none";
          fsType = "tmpfs";
        };
        system.stateVersion = "26.05";
        users.users.alice.isNormalUser = true;

        zeh.ai = {
          username = "alice";
          secrets = {
            omniroute_api_key = "/run/secrets/omniroute_api_key";
            velox_api_key = "/run/secrets/velox_api_key";
            z_ai_api_key = "/run/secrets/z_ai_api_key";
          };
          harnesses = lib.genAttrs [ "claude-code" "opencode" "pi" "gemini" "command-code" "hermes-agent" ] (_: {
            enable = true;
          });
          tools = lib.genAttrs [ "rtk" "lsp-mcp" "prompt-enhancer" "rules-enforcer" ] (_: {
            enable = true;
          });
        };
      }
    ];
  };
  inherit (system.config.zeh) ai;

  expectHome = [
    ".claude"
    ".claude-code-router"
    ".commandcode"
    ".config/opencode"
    ".gemini"
    ".hermes"
    ".pi/agent"
    ".config/lsp-mcp/config.json"
    ".local/share/zeh-ai-tooling/claude-plugins"
  ];
  expectWrappers = [
    "claude"
    "opencode"
    "gemini"
    "cmd"
    "hermes"
    "rtk"
    "ultimate-browsing"
    "browser-dev-cycle-node"
  ];
  failures =
    map (p: "missing home item ${p}") (builtins.filter (p: !(ai.home ? ${p})) expectHome)
    ++ map (w: "missing wrapper ${w}") (builtins.filter (w: !(ai.wrappers ? ${w})) expectWrappers)
    ++ lib.optional (!(ai.harnesses.claude-code.skills ? oh-my-claudecode)) "oh-my-claudecode skill not routed to claude-code"
    ++ lib.optional (ai.harnesses.pi.skills ? oh-my-claudecode) "oh-my-claudecode skill leaked into pi"
    ++ lib.optional (!(ai.harnesses.opencode.skills ? grafana)) "MCP skill grafana not routed to opencode"
    ++ lib.optional (!(lib.hasInfix "## Code exploration" ai.harnesses.pi.baseRules)) "pi rule missing from pi"
    ++ lib.optional (lib.hasInfix "## Code exploration" ai.harnesses.claude-code.baseRules) "pi rule leaked into claude-code"
    ++ lib.optional (!(lib.hasPrefix "# CLAUDE.md\n\n" ai.harnesses.claude-code.baseRules)) "claude-code rules header";

  # Instantiating the item sources forces every rendered file's derivation.
  drvs = lib.mapAttrsToList (_: item: (item.source or null).drvPath or "") ai.home;
in
{
  inherit failures;
  forced = builtins.deepSeq drvs true;
}
