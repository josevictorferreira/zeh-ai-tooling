# Harness: Nous Research Hermes Agent.
# Installs hermes-agent via the official install script on first use; takes no
# catalog content (no `skills` option).
_:
{ config
, lib
, pkgs
, ...
}:
let
  cfg = config.zeh.ai.harnesses.hermes-agent;

  # hermes wrappers run the install script on first use
  mkHermesBin =
    name: subcommand:
    pkgs.writeShellScriptBin name ''
      set -euo pipefail

      HERMES_HOME="$HOME/.hermes"
      HERMES_BIN="$HERMES_HOME/hermes-agent/venv/bin/hermes"

      # Install if not present
      if [ ! -x "$HERMES_BIN" ]; then
        echo "Installing hermes-agent..."
        curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup
      fi

      exec "$HERMES_BIN" ${subcommand}"$@"
    '';
in
{
  options.zeh.ai.harnesses.hermes-agent.enable = lib.mkEnableOption "Hermes Agent";

  config = lib.mkIf cfg.enable {
    zeh.ai.wrappers.hermes.packages = [
      (mkHermesBin "hermes" "")
      # hermes-gateway wrapper for messaging platforms
      (mkHermesBin "hermes-gateway" "gateway ")
    ];

    # The .hermes dir is managed by the install script; only seed it once.
    zeh.ai.home.".hermes" = {
      kind = "dir";
      mode = "seed";
      source = pkgs.runCommand "hermes-empty-dir" { } "mkdir -p $out";
    };
  };
}
