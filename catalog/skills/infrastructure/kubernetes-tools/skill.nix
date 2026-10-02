{ lib, pkgs, ... }:
{
  mcp.kubernetes = {
    command = lib.getExe' pkgs.nodejs "npx";
    args = [
      "-y"
      "kubernetes-mcp-server@latest"
    ];
  };
}
