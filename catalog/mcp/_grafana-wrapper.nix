# Grafana MCP reads GRAFANA_*; zsh only exports GRAFANA_WORK_* from /run/secrets.
# GUI-spawned clients get no zsh shellInit, so the wrapper reads the secrets too.
{ lib, pkgs }:
let
  grafanaWorkSecret = key: ''"$(_grafanaSecret /run/secrets/${key})"'';
in
pkgs.writeShellScript "mcp-grafana-wrapper" ''
  _grafanaSecret() {
    [ -r "$1" ] && ${lib.getExe' pkgs.coreutils "cat"} "$1" || true
  }
  export GRAFANA_URL=''${GRAFANA_URL:-''${GRAFANA_WORK_URL:-${grafanaWorkSecret "grafana_work_url"}}}
  export GRAFANA_SERVICE_ACCOUNT_TOKEN=''${GRAFANA_SERVICE_ACCOUNT_TOKEN:-''${GRAFANA_WORK_SERVICE_ACCOUNT_TOKEN:-${grafanaWorkSecret "grafana_work_service_account_token"}}}
  export GRAFANA_USERNAME=''${GRAFANA_USERNAME:-''${GRAFANA_WORK_USERNAME:-${grafanaWorkSecret "grafana_work_username"}}}
  export GRAFANA_PASSWORD=''${GRAFANA_PASSWORD:-''${GRAFANA_WORK_PASSWORD:-${grafanaWorkSecret "grafana_work_password"}}}
  export GRAFANA_ORG_ID=''${GRAFANA_ORG_ID:-1}
  exec ${lib.getExe pkgs.mcp-grafana} "$@"
''
