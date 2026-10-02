# Tool: RTK. Puts `rtk` on PATH and wires a Claude Code PreToolUse hook that
# rewrites Bash commands through `rtk rewrite`.
_:
{ config
, lib
, pkgs
, ...
}:
let
  cfg = config.zeh.ai.tools.rtk;
  rtkPkg = pkgs.callPackage ./package.nix { };

  rtkClaudeHook = pkgs.writeShellScript "rtk-claude-hook" ''
    #!/usr/bin/env bash
    # rtk-hook-version: 3
    # RTK Claude Code hook -- rewrites commands to use rtk for token savings.

    CACHE_DIR=''${XDG_CACHE_HOME:-$HOME/.cache}
    CACHE_FILE="$CACHE_DIR/rtk-hook-version-ok"
    if [ ! -f "$CACHE_FILE" ]; then
      RTK_VERSION_RAW=$(${rtkPkg}/bin/rtk --version 2>/dev/null)
      RTK_VERSION=''${RTK_VERSION_RAW#rtk }
      RTK_VERSION=''${RTK_VERSION%% *}
      if [ -n "$RTK_VERSION" ]; then
        IFS=. read -r MAJOR MINOR PATCH <<<"$RTK_VERSION"
        if [ "$MAJOR" -eq 0 ] && [ "$MINOR" -lt 23 ]; then
          echo "[rtk] WARNING: rtk $RTK_VERSION is too old (need >= 0.23.0)" >&2
          exit 0
        fi
      fi
      mkdir -p "$CACHE_DIR" 2>/dev/null
      touch "$CACHE_FILE" 2>/dev/null
    fi

    INPUT=$(cat)
    CMD=$(${pkgs.jq}/bin/jq -r '.tool_input.command // empty' <<<"$INPUT")

    if [ -z "$CMD" ]; then
      exit 0
    fi

    REWRITTEN=$(${rtkPkg}/bin/rtk rewrite "$CMD" 2>/dev/null)
    EXIT_CODE=$?

    case $EXIT_CODE in
      0)
        [ "$CMD" = "$REWRITTEN" ] && exit 0
        ;;
      1)
        exit 0
        ;;
      2)
        exit 0
        ;;
      3)
        ;;
      *)
        exit 0
        ;;
    esac

    if [ "$EXIT_CODE" -eq 3 ]; then
      ${pkgs.jq}/bin/jq -c --arg cmd "$REWRITTEN" \
        '.tool_input.command = $cmd | {
          "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "updatedInput": .tool_input
          }
        }' <<<"$INPUT"
    else
      ${pkgs.jq}/bin/jq -c --arg cmd "$REWRITTEN" \
        '.tool_input.command = $cmd | {
          "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": "RTK auto-rewrite",
            "updatedInput": .tool_input
          }
        }' <<<"$INPUT"
    fi
  '';
in
{
  options.zeh.ai.tools.rtk.enable = lib.mkEnableOption "RTK (Rust Token Killer)";

  config = lib.mkIf cfg.enable {
    zeh.ai.wrappers.rtk.packages = [ rtkPkg ];

    zeh.ai.harnesses.claude-code.settings.hooks = {
      PreToolUse = [
        {
          matcher = "Bash";
          hooks = [
            {
              type = "command";
              command = "${rtkClaudeHook}";
            }
          ];
        }
      ];
    };
  };
}
