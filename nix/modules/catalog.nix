# Loads catalog/ and routes each enabled item to the harnesses that accept it.
#
#   zeh.ai.skills.<name>    = { enable; harnesses; }   -> zeh.ai.harnesses.<h>.skills.<name>
#   zeh.ai.agents.<name>    = { enable; harnesses; }   -> zeh.ai.harnesses.<h>.agents.<name>
#   zeh.ai.commands.<name>  = { enable; harnesses; }   -> zeh.ai.harnesses.<h>.commands.<name>
#   zeh.ai.mcp.<name>       = { enable; harnesses; }   -> zeh.ai.harnesses.<h>.mcps.<name>
#   zeh.ai.rules.<name>     = { enable; harnesses; }   -> zeh.ai.harnesses.<h>.baseRules
#
# A harness accepts catalog content by declaring a `skills` option.
{ config
, options
, lib
, pkgs
, ...
}:
let
  zeh = import ../lib { inherit lib pkgs; };
  catalog = zeh.catalog.load {
    root = ../../catalog;
    args = { inherit lib pkgs; };
  };
  cfg = config.zeh.ai;

  targets = builtins.filter (h: options.zeh.ai.harnesses.${h} ? skills) (
    builtins.attrNames options.zeh.ai.harnesses
  );

  itemOptions =
    kind: items:
    lib.mapAttrs
      (name: item: {
        enable = lib.mkOption {
          type = lib.types.bool;
          default = item.enable;
          description = "Whether to install the ${kind} `${name}`.";
        };
        harnesses = lib.mkOption {
          type = lib.types.nullOr (lib.types.listOf lib.types.str);
          default = item.harnesses;
          description = "Harnesses that receive the ${kind} `${name}`; null means every harness.";
        };
      })
      items;

  appliesTo = itemCfg: h: itemCfg.enable && (itemCfg.harnesses == null || builtins.elem h itemCfg.harnesses);

  # kind in catalog / option set -> option name inside zeh.ai.harnesses.<h>
  routes = {
    skills = "skills";
    agents = "agents";
    commands = "commands";
    mcp = "mcps";
  };
  payload = kind: item: if kind == "mcp" then item.config else item.definition;

  route =
    h:
    lib.mapAttrs'
      (
        kind: field:
        lib.nameValuePair field (
          lib.mapAttrs (name: item: lib.mkIf (appliesTo cfg.${kind}.${name} h) (payload kind item)) catalog.${kind}
        )
      )
      routes;

  rulesFor =
    h:
    let
      texts = lib.mapAttrsToList (_: r: r.text) (
        lib.filterAttrs (name: _: appliesTo cfg.rules.${name} h) catalog.rules
      );
    in
    lib.optionalString (texts != [ ]) (
      "# ${config.zeh.ai.harnesses.${h}.contextFile}\n\n" + lib.concatStringsSep "\n\n" texts
    );
in
{
  options.zeh.ai = lib.mapAttrs itemOptions {
    skills = catalog.skills;
    agents = catalog.agents;
    commands = catalog.commands;
    mcp = catalog.mcp;
    rules = catalog.rules;
  };

  config = lib.mkMerge (
    [
      {
        zeh.ai.harnesses = lib.genAttrs targets (h: route h // { baseRules = rulesFor h; });
      }
    ]
    ++ lib.mapAttrsToList (name: skill: lib.mkIf cfg.skills.${name}.enable { zeh.ai.wrappers = skill.wrappers; }) (
      lib.filterAttrs (_: s: s.wrappers != { }) catalog.skills
    )
  );
}
