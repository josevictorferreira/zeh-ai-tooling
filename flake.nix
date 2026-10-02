{
  description = "zeh-ai-tooling: skills, agents, commands, rules, MCP servers, plugins and coding-agent installs, in one place";

  inputs = {
    nixpkgs.url = "nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  outputs =
    inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      imports = [
        flake-parts.flakeModules.modules
        ./nix/flake.nix
      ];
    };
}
