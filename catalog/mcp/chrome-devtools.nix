{ lib, pkgs, ... }:
{
  harnesses = [ "claude-code" ];
  config = {
    type = "local";
    enabled = false;
    command = pkgs.writeShellScript "mcp-chrome-devtools-wrapper" ''
      export PATH="${lib.getBin pkgs.nodejs + "/bin"}:$PATH"
      exec ${lib.getExe' pkgs.nodejs "npx"} -y chrome-devtools-mcp@latest \
        --headless=true \
        --isolated=true \
        --executablePath=${lib.getExe pkgs.brave} \
        "$@"
    '';
    args = [ ];
  };
}
