# Library exported as `lib` by the flake. `pkgs` is only needed by
# `generators` (YAML) and `files`; the parsers and renderers are pure.
{ lib
, pkgs ? null
}:
let
  yaml = import ./yaml.nix { inherit lib; };
  frontmatter = import ./frontmatter.nix { inherit lib yaml; };
  catalog = import ./catalog.nix { inherit lib frontmatter; };
  render = import ./render.nix { inherit lib; };
  generators = import ./generators.nix { inherit lib pkgs; };
  files = import ./files.nix { inherit lib pkgs generators; };
in
{
  inherit
    yaml
    frontmatter
    catalog
    render
    generators
    files
    ;
}
