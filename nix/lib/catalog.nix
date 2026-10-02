# Load catalog/ into normalized attrsets. No registry: every directory/file is an item.
#
#   skills/<category>/<name>/SKILL.md   (+ any files; optional skill.nix)
#   agents/<category>/<name>.md
#   commands/<category>/<name>.md
#   rules/<name>.md
#   mcp/<name>.nix
#
# Entries whose name starts with `_` or `.` are ignored (shared helpers, drafts).
# Item names are global: the same name in two categories is an error.
#
# Every item has `enable` (default true) and `harnesses` (null = every harness
# that accepts this kind). Both come from frontmatter and are stripped from the
# definition handed to the renderers.
{ lib, frontmatter }:
let
  visible = name: !(lib.hasPrefix "_" name || lib.hasPrefix "." name);

  entries =
    type: dir:
    if builtins.pathExists dir then
      lib.filterAttrs (name: t: t == type && visible name) (builtins.readDir dir)
    else
      { };

  subdirs = dir: builtins.attrNames (entries "directory" dir);

  filesWithSuffix =
    suffix: dir: builtins.filter (lib.hasSuffix suffix) (builtins.attrNames (entries "regular" dir));

  # Merge per-category attrsets, failing on a name defined twice.
  mergeUnique =
    kind: sets:
    lib.foldl'
      (
        acc: set:
        let
          dup = builtins.filter (n: acc ? ${n}) (builtins.attrNames set);
        in
        if dup != [ ] then throw "catalog: ${kind} `${builtins.head dup}` is defined twice" else acc // set
      )
      { }
      sets;

  metaKeys = [
    "enable"
    "harnesses"
  ];

  checkName =
    kind: name: attrs:
    if (attrs.name or name) != name then
      throw "catalog: ${kind} `${name}` declares name `${attrs.name}`; it must match its file/directory name"
    else
      attrs;

  # <kind>/<category>/<name>.md
  loadMarkdownItems =
    kind: root:
    let
      dir = root + "/${kind}";
      loadCategory =
        category:
        let
          catDir = dir + "/${category}";
        in
        lib.listToAttrs (
          map
            (
              file:
              let
                name = lib.removeSuffix ".md" file;
                doc = frontmatter.parseFile (catDir + "/${file}");
                attrs = checkName kind name doc.attrs;
              in
              lib.nameValuePair name {
                inherit category;
                enable = attrs.enable or true;
                harnesses = attrs.harnesses or null;
                definition = { inherit name; } // builtins.removeAttrs attrs metaKeys // { prompt = doc.body; };
              }
            )
            (filesWithSuffix ".md" catDir)
        );
    in
    mergeUnique kind (map loadCategory (subdirs dir));

  loadSkill =
    args: category: skillDir: name:
    let
      doc = frontmatter.parseFile (skillDir + "/SKILL.md");
      attrs = checkName "skill" name doc.attrs;
      extra =
        if builtins.pathExists (skillDir + "/skill.nix") then
          import (skillDir + "/skill.nix") (args // { inherit skillDir; })
        else
          { };
      substitutions = extra.substitutions or { };
      substitute = builtins.replaceStrings (builtins.attrNames substitutions) (builtins.attrValues substitutions);

      relFiles = map (p: lib.removePrefix "${toString skillDir}/" (toString p)) (
        lib.filesystem.listFilesRecursive skillDir
      );
      shipped = builtins.filter (rel: rel != "SKILL.md" && rel != "skill.nix") relFiles;
      files =
        lib.genAttrs shipped (
          rel:
          let
            path = skillDir + "/${rel}";
          in
          if builtins.elem rel (extra.substituteIn or [ ]) then substitute (builtins.readFile path) else path
        )
        // (extra.files or { });

      mcp = (attrs.mcp or { }) // (extra.mcp or { });
    in
    {
      inherit category;
      enable = attrs.enable or true;
      # Skills that bring MCP servers default to opencode, the only harness that
      # loads `mcp:` from SKILL.md frontmatter.
      harnesses = attrs.harnesses or (if mcp != { } then [ "opencode" ] else null);
      wrappers = extra.wrappers or { };
      definition =
        { inherit name; }
        // builtins.removeAttrs attrs metaKeys
        // {
          prompt = substitute doc.body;
          inherit files;
        }
        // lib.optionalAttrs (mcp != { }) { inherit mcp; };
    };

  loadSkills =
    args: root:
    let
      dir = root + "/skills";
      loadCategory =
        category:
        let
          catDir = dir + "/${category}";
        in
        lib.genAttrs (subdirs catDir) (name: loadSkill args category (catDir + "/${name}") name);
    in
    mergeUnique "skill" (map loadCategory (subdirs dir));

  loadRules =
    root:
    let
      dir = root + "/rules";
    in
    lib.listToAttrs (
      map
        (
          file:
          let
            doc = frontmatter.parseFile (dir + "/${file}");
          in
          lib.nameValuePair (lib.removeSuffix ".md" file) {
            enable = doc.attrs.enable or true;
            harnesses = doc.attrs.harnesses or null;
            text = doc.body;
          }
        )
        (filesWithSuffix ".md" dir)
    );

  loadMcp =
    args: root:
    let
      dir = root + "/mcp";
    in
    lib.listToAttrs (
      map
        (
          file:
          let
            item = import (dir + "/${file}") args;
          in
          lib.nameValuePair (lib.removeSuffix ".nix" file) {
            enable = item.enable or true;
            harnesses = item.harnesses or null;
            inherit (item) config;
          }
        )
        (filesWithSuffix ".nix" dir)
    );

  # args: what skill.nix / mcp/*.nix receive ({ pkgs, lib, … }).
  load =
    { root, args }:
    {
      skills = loadSkills args root;
      agents = loadMarkdownItems "agents" root;
      commands = loadMarkdownItems "commands" root;
      rules = loadRules root;
      mcp = loadMcp args root;
    };
in
{
  inherit load;
}
