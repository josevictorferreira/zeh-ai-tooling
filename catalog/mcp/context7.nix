# npx-based servers pin PATH to their own Node so a `nix develop` shell
# cannot inject a different Node version.
{ lib, pkgs, ... }:
{
  harnesses = [ "claude-code" ];
  config = {
    enabled = false;
    type = "local";
    command = pkgs.writeShellScript "mcp-context7-wrapper" ''
      export PATH="${lib.getBin pkgs.nodejs + "/bin"}:$PATH"
      exec ${lib.getExe' pkgs.nodejs "npx"} -y @upstash/context7-mcp --api-key "''${CONTEXT7_API_KEY}" "$@"
    '';
    args = [ ];
  };
}
