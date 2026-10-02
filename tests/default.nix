# `nix flake check` suite. Each check is evaluated (and fails evaluation with a
# message) before anything is built.
{ pkgs, lib }:
let
  zeh = import ../nix/lib { inherit lib pkgs; };

  check =
    name: failures:
    if failures == [ ] then
      pkgs.runCommand "zeh-ai-check-${name}" { } "touch $out"
    else
      throw "check `${name}` failed:\n  - ${lib.concatStringsSep "\n  - " failures}";

  # frontmatter/<case>.md must parse to frontmatter/<case>.json
  frontmatterCases = map (lib.removeSuffix ".md") (
    builtins.filter (lib.hasSuffix ".md") (builtins.attrNames (builtins.readDir ./frontmatter))
  );
  frontmatterFailures = builtins.filter (x: x != null) (
    map
      (
        c:
        let
          got = zeh.frontmatter.parseFile (./frontmatter + "/${c}.md");
          want = lib.importJSON (./frontmatter + "/${c}.json");
        in
        if got == want then null else "${c}: got ${builtins.toJSON got}"
      )
      frontmatterCases
  );

  # render/sample-agent.md rendered for each harness format == snapshot
  sample =
    let
      doc = zeh.frontmatter.parseFile ./render/sample-agent.md;
    in
    doc.attrs // { prompt = doc.body; };
  renderFailures = builtins.filter (x: x != null) (
    lib.mapAttrsToList (file: got: if got == builtins.readFile (./render + "/${file}") then null else "render/${file} differs")
      {
        "sample-agent.claude.md" = zeh.render.toClaudeMarkdownPrompt sample;
        "sample-agent.opencode.md" = zeh.render.toOpencodeMarkdownPrompt sample;
        "sample-agent.gemini.toml" = zeh.render.toGeminiToml sample;
      }
  );

  # The whole catalog loads (skill.nix and mcp/*.nix included) and every
  # skill/agent/command describes itself.
  catalog = zeh.catalog.load {
    root = ../catalog;
    args = { inherit lib pkgs; };
  };
  forced = builtins.unsafeDiscardStringContext (
    builtins.toJSON (lib.mapAttrs (_: items: lib.mapAttrs (_: i: i.definition or i.config or i.text) items) catalog)
  );
  catalogFailures = lib.concatLists (
    map
      (
        kind:
        lib.mapAttrsToList (name: _: "${kind}/${name} has no description") (
          lib.filterAttrs (_: item: (item.definition.description or "") == "") catalog.${kind}
        )
      )
      [
        "skills"
        "agents"
        "commands"
      ]
  );
  module = import ./module.nix { inherit pkgs lib; };
in
{
  frontmatter = check "frontmatter" frontmatterFailures;
  render = check "render" renderFailures;
  catalog = builtins.seq forced (check "catalog" catalogFailures);
}
// lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
  module = builtins.seq module.forced (check "module" module.failures);
}
