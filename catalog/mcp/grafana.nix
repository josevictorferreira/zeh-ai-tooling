{ lib, pkgs, ... }:
{
  harnesses = [ ];
  config = {
    type = "local";
    enabled = false;
    command = import ./_grafana-wrapper.nix { inherit lib pkgs; };
    args = [ ];
  };
}
