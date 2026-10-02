# flake-parts module: everything this flake exports.
{ inputs, ... }:
{
  flake = {
    # NixOS / nix-darwin modules: import `default`, then set `zeh.ai.*`.
    modules.nixos.default = import ./modules { isDarwin = false; };
    modules.darwin.default = import ./modules { isDarwin = true; };

    # Pure helpers: frontmatter parser, catalog loader, renderers.
    lib = import ./lib { inherit (inputs.nixpkgs) lib; };
  };

  perSystem =
    { pkgs, lib, ... }:
    {
      packages = {
        rtk = pkgs.callPackage ../packages/rtk/package.nix { };
        prompt-enhancer = pkgs.callPackage ../packages/prompt-enhancer/package.nix { };
        rules-enforcer = pkgs.callPackage ../packages/rules-enforcer/package.nix { };
      };

      checks = import ../tests { inherit pkgs lib; };

      formatter = pkgs.nixpkgs-fmt;
    };
}
