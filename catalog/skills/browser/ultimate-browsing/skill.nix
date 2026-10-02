# Points the Playwright templates at the nixpkgs playwright and installs the
# `ultimate-browsing*` wrappers that run the engine with its Python deps.
{ lib, pkgs, skillDir, ... }:
let
  runtime = import ../_runtime.nix { inherit pkgs; };
  playwrightRequire = {
    "require('playwright')" = "require('${pkgs.playwright}/index.js')";
  };

  # Same layout as upstream: engine/ and the cookie scripts/ side by side.
  engineSrc = skillDir + "/scripts/engine";
  scriptsSrc = lib.fileset.toSource {
    root = skillDir + "/scripts";
    fileset = lib.fileset.difference (skillDir + "/scripts") (
      lib.fileset.unions [
        engineSrc
        (skillDir + "/scripts/ATTRIBUTION.md")
      ]
    );
  };
  engineRuntime = pkgs.runCommand "ultimate-browsing-runtime" { } ''
    mkdir -p "$out"
    cp -r ${engineSrc} "$out/engine"
    cp -r ${scriptsSrc} "$out/scripts"
    substituteInPlace "$out"/engine/templates/*.js --replace-fail "require('playwright')" "require('${pkgs.playwright}/index.js')"
  '';
  path = lib.makeBinPath runtime.packages;
  python = "${runtime.pythonEnv}/bin/python3";
  wrapper = name: body: {
    command = "${pkgs.writeShellScriptBin name body}/bin/${name}";
    inherit (runtime) packages;
  };
in
{
  substitutions = playwrightRequire;
  substituteIn = [
    "scripts/engine/templates/playwright_mobile_chrome.js"
    "scripts/engine/templates/playwright_real_chrome.js"
  ];

  wrappers = runtime.wrappers // {
    ultimate-browsing = wrapper "ultimate-browsing" ''
      export PATH="${path}:$PATH"
      export PYTHONPATH="${engineRuntime}:$PYTHONPATH"
      exec ${python} -m engine "$@"
    '';
    ultimate-browsing-cookies = wrapper "ultimate-browsing-cookies" ''
      export PATH="${path}:$PATH"
      exec ${python} ${engineRuntime}/scripts/extract_cookies.py "$@"
    '';
    ultimate-browsing-bias-check = wrapper "ultimate-browsing-bias-check" ''
      export PATH="${path}:$PATH"
      exec ${python} ${engineRuntime}/engine/bias_check.py "$@"
    '';
  };
}
