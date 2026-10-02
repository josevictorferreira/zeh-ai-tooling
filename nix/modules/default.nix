# The module consumers import (flake output modules.{nixos,darwin}.default).
# Auto-discovers harnesses/<name>/default.nix and packages/<name>/module.nix,
# so adding either is just a new directory.
{ isDarwin }:
let
  dirsWith =
    root: file:
    builtins.filter (name: builtins.pathExists (root + "/${name}/${file}")) (
      builtins.attrNames (builtins.readDir root)
    );
  load = root: file: map (name: import (root + "/${name}/${file}") { inherit isDarwin; }) (dirsWith root file);
in
{
  imports = [
    (import ./core.nix { inherit isDarwin; })
    ./catalog.nix
  ]
  ++ load ../../harnesses "default.nix"
  ++ load ../../packages "module.nix";
}
