# Harness: OpenCode.
# NixOS: FHS environment wrapper for glibc compatibility. Darwin: direct execution.
{ isDarwin }:
{ config
, lib
, pkgs
, ...
}:
let
  zeh = import ../../nix/lib { inherit lib pkgs; };
  cfg = config.zeh.ai.harnesses.opencode;

  wrapperDefs = import ./wrapper.nix {
    inherit pkgs;
    inherit (cfg) version;
  };
  inherit (wrapperDefs) shellScriptBinLinux shellScriptBinDarwin;

  opencodeConfigs =
    (zeh.render.mkOpencodeMdConfigs "agent" cfg.agents)
    // (zeh.render.mkOpencodeMdConfigs "command" cfg.commands)
    // (zeh.render.mkSkillsConfigs cfg.skills)
    // {
      "AGENTS.md" = cfg.baseRules;
      "opencode.json" = cfg.settings;
      "oh-my-openagent.json" = cfg.ohMyOpenCodeSettings;
      "tui.json" = {
        theme = "tokyonight";
        plugins = [ "oh-my-openagent/tui" ];
      };
    }
    // cfg.extraConfigFiles;

  opencodeConfigDir = zeh.files.mkConfigDir
    {
      name = "opencode-config";
      prefix = "opencode";
    }
    opencodeConfigs;
in
{
  imports = [
    ./options.nix
    ./settings/formatter.nix
    ./settings/lsp.nix
    ./settings/permission.nix
    ./settings/provider.nix
    ./settings/plugins.nix
  ];

  config = lib.mkMerge [
    {
      # Default settings
      zeh.ai.harnesses.opencode.settings = {
        theme = lib.mkDefault "tokyonight";
        mcp = lib.mkDefault (lib.mapAttrs (_name: mcpCfg: zeh.render.transformMcpOptions "opencode" mcpCfg) cfg.mcps);
        instructions = [
          ".docs/rules.md"
        ];

        compaction = {
          auto = true;
          prune = true;
          reserved = 10000;
        };

        watcher = {
          ignore = [
            "dcp.jsonc"
            "dcp.json"
            "node_modules/**"
            "dist/**"
            ".git/**"
            "build/**"
            ".bundle/**"
            "__pycache__/**"
            ".bun_cache/**"
            "tui.json"
          ];
        };

        small_model = "omniroute/pippin";
        default_agent = "engineer";
      };
    }

    (lib.mkIf cfg.enable {
      zeh.ai.home = {
        ".hindsight" = {
          kind = "dir";
          mode = "copy";
          source = pkgs.linkFarm "hindsight-config" [
            {
              name = "opencode.json";
              path = pkgs.writeText "hindsight-opencode.json" (
                builtins.toJSON {
                  hindsightApiUrl = "https://hindsight-api.josevictor.me";
                  # Per-project memory isolation, shared with pi.
                  # gitProject = basename of the main worktree root from
                  # `git rev-parse --git-common-dir`; falls back to cwd
                  # basename when not in a repo. Pi's hindsight_* tools
                  # (plugins/pi/hindsight) derive the same string.
                  dynamicBankId = true;
                  dynamicBankGranularity = [ "gitProject" ];
                  autoRecall = true;
                  autoRetain = true;
                  recallBudget = "mid";
                  # Retain only the most recent user/assistant turn, not the whole session.
                  retainMode = "last-turn";
                }
              );
            }
          ];
          preserve = [ ];
        };
        ".config/opencode" = {
          kind = "dir";
          mode = "copy";
          source = opencodeConfigDir;
          preserve = [
            "dcp.jsonc"
            "dcp.json"
            "tui.json"
          ];
        };

        # Plugin-state sentinel: runs ONLY when the declared plugin list changes.
        # Performs a surgical cleanup of opencode's plugin runtime (node_modules,
        # lockfiles, plugin-wrapper binaries like `opencode.mcpflow-real`) while
        # preserving the main opencode binary so rebuilds don't force a 142 MB
        # re-download. Version bumps are handled separately by the wrapper,
        # which compares the declared version against ~/.opencode/.installed-version.
        ".cache/opencode-nix-state/plugins.json" = {
          kind = "file";
          mode = "copy";
          text = builtins.toJSON (cfg.settings.plugin or [ ]);
          postInstall = ''
            OPENCODE_HOME="$HOME_DIR/.opencode"
            if [ -d "$OPENCODE_HOME" ]; then
              echo "[opencode] Plugin list changed; clearing plugin state (keeping opencode binary)."
              rm -rf "$OPENCODE_HOME/node_modules" \
                     "$OPENCODE_HOME/package.json" \
                     "$OPENCODE_HOME/package-lock.json"
              # Remove plugin-installed wrapper binaries (e.g. opencode.mcpflow-real,
              # opencode.bak) but leave the main `opencode` binary in place.
              if [ -d "$OPENCODE_HOME/bin" ]; then
                find "$OPENCODE_HOME/bin" -maxdepth 1 -type f \
                  -name 'opencode.*' -delete 2>/dev/null || true
              fi
            fi
            # Remove the obsolete combined sentinel from earlier iterations.
            rm -f "$HOME_DIR/.cache/opencode-nix-state/install.json"
          '';
        };
      };

      zeh.ai.wrappers.opencode = {
        packages = [
          pkgs.bun
        ]
        ++ lib.optional isDarwin shellScriptBinDarwin
        ++ lib.optional (!isDarwin) shellScriptBinLinux;
      };
    })
  ];
}
