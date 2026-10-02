# Atlassian's official remote MCP server (Jira + Confluence Cloud), bridged to
# stdio via mcp-remote. Auth is OAuth: first use opens a browser; tokens are
# cached in ~/.mcp-auth (outside nix management).
{ lib, pkgs, ... }:
{
  harnesses = [ "claude-code" ];
  config = {
    type = "local";
    enabled = false;
    command = pkgs.writeShellScript "mcp-jira-wrapper" ''
      export PATH="${lib.getBin pkgs.nodejs + "/bin"}:$PATH"
      exec ${lib.getExe' pkgs.nodejs "npx"} -y mcp-remote https://mcp.atlassian.com/v1/sse "$@"
    '';
    args = [ ];
  };
}
