# Outputs every other module writes to. This repo never touches the consumer's
# home-file or wrapper machinery directly: the consumer maps these options onto
# its own (see README "Consumer glue").
{ isDarwin }:
{ config
, lib
, ...
}:
let
  # Identical definitions from several modules merge (e.g. a runtime wrapper
  # that two skills both declare); differing ones are an error.
  equalAttrs = lib.mkOptionType {
    name = "zeh-ai-equal-attrs";
    description = "attribute set (identical definitions merge)";
    check = builtins.isAttrs;
    merge = lib.options.mergeEqualOption;
  };
in
{
  options.zeh.ai = {
    username = lib.mkOption {
      type = lib.types.str;
      description = "User that receives the AI tooling (home files, wrappers, packages).";
    };

    homeDirectory = lib.mkOption {
      type = lib.types.str;
      default =
        let
          declared = config.users.users.${config.zeh.ai.username}.home or null;
        in
        if declared != null then declared else if isDarwin then "/Users/${config.zeh.ai.username}" else "/home/${config.zeh.ai.username}";
      defaultText = lib.literalExpression "config.users.users.\${config.zeh.ai.username}.home";
      description = "Home directory of `zeh.ai.username`, for settings that need an absolute path.";
    };

    home = lib.mkOption {
      type = lib.types.attrsOf lib.types.raw;
      default = { };
      description = ''
        Items to materialize under the user's $HOME, keyed by relative path.
        Each value is { kind = "file" | "dir"; mode = "copy" | "link" | "seed";
        source | text | json | toml = …; preserve = [ … ]; postInstall = "…"; }.
      '';
    };

    wrappers = lib.mkOption {
      type = lib.types.attrsOf equalAttrs;
      default = { };
      description = ''
        Programs to put on the user's PATH, keyed by program name:
        { packages = [ … ]; command = "<exe>" (optional); env = { … } (optional); }.
      '';
    };

    secrets = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = {
        velox_api_key = "/run/secrets/velox_api_key";
      };
      description = "Paths of secret files, by name. Only the path lands in the store.";
    };
  };
}
