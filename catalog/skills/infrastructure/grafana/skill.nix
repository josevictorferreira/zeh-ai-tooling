{ lib, pkgs, ... }:
{
  mcp.grafana = {
    command = lib.getExe pkgs.mcp-grafana;
    args = [ ];
    env = {
      "GRAFANA_URL" = "{env:GRAFANA_WORK_URL}";
      "GRAFANA_SERVICE_ACCOUNT_TOKEN" = "{env:GRAFANA_WORK_SERVICE_ACCOUNT_TOKEN}";
      "GRAFANA_USERNAME" = "{env:GRAFANA_WORK_USERNAME}";
      "GRAFANA_PASSWORD" = "{env:GRAFANA_WORK_PASSWORD}";
      "GRAFANA_ORG_ID" = "1";
    };
  };
}
