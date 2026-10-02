# Points the playwright-core imports at the nixpkgs playwright, ships the MCP
# servers the skill drives, and installs `browser-dev-cycle-*` wrappers that run
# the scripts with that playwright resolvable.
{ lib, pkgs, skillDir, ... }:
let
  runtime = import ../_runtime.nix { inherit pkgs; };
  npx = lib.getExe' pkgs.nodejs "npx";
  defaultBrowser = lib.getExe pkgs.brave;

  playwrightImport = {
    "from 'playwright-core';" = "from '${pkgs.playwright}/index.mjs';";
  };
  substitute = builtins.replaceStrings (builtins.attrNames playwrightImport) (builtins.attrValues playwrightImport);
  script = name: pkgs.writeText "browser-dev-cycle-${lib.removeSuffix ".mjs" name}.mjs" (substitute (builtins.readFile (skillDir + "/scripts/${name}")));

  loader = pkgs.writeText "browser-dev-cycle-playwright-loader.mjs" ''
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === "playwright-core") {
        return {
          url: "file://${pkgs.playwright}/index.mjs",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    }
  '';
  node = pkgs.writeShellScriptBin "browser-dev-cycle-node" ''
    exec ${lib.getExe pkgs.nodejs} --experimental-loader ${loader} "$@"
  '';
  scriptBin =
    name: file:
    pkgs.writeShellScriptBin name ''
      exec ${node}/bin/browser-dev-cycle-node ${script file} "$@"
    '';
  wrapper = drv: {
    command = "${drv}/bin/${drv.name}";
    inherit (runtime) packages;
  };
in
{
  substitutions = playwrightImport;
  substituteIn = [
    "scripts/network-mock.mjs"
    "scripts/playwright-helper.mjs"
    "scripts/viewport-test.mjs"
  ];

  mcp = {
    playwright = {
      command = pkgs.writeShellScript "mcp-playwright-wrapper" ''
        export PATH="${lib.getBin pkgs.nodejs}/bin:$PATH"
        exec ${npx} -y @playwright/mcp@latest \
          --browser=chrome \
          --executable-path=${defaultBrowser} \
          "$@"
      '';
      args = [ ];
    };
    chrome-devtools = {
      command = pkgs.writeShellScript "mcp-chrome-devtools-wrapper" ''
        export PATH="${lib.getBin pkgs.nodejs}/bin:$PATH"
        exec ${npx} -y chrome-devtools-mcp@latest \
          --headless=true \
          --isolated=true \
          --executablePath=${defaultBrowser} \
          "$@"
      '';
      args = [ ];
    };
  };

  wrappers = runtime.wrappers // {
    browser-dev-cycle-node = wrapper node;
    browser-dev-cycle-network-mock = wrapper (scriptBin "browser-dev-cycle-network-mock" "network-mock.mjs");
    browser-dev-cycle-playwright-helper = wrapper (scriptBin "browser-dev-cycle-playwright-helper" "playwright-helper.mjs");
    browser-dev-cycle-viewport-test = wrapper (scriptBin "browser-dev-cycle-viewport-test" "viewport-test.mjs");
  };
}
