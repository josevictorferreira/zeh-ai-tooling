{ lib, pkgs, ... }:
{
  harnesses = [ "claude-code" ];
  config = {
    command = import ./_grafana-wrapper.nix { inherit lib pkgs; };
    args = [ ];
    type = "local";
    enabled = false;
  };
}
