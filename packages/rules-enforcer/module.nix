# Tool: rules-enforcer script, installed into the user's packages.
_:
{ config
, lib
, pkgs
, ...
}:
{
  options.zeh.ai.tools.rules-enforcer.enable = lib.mkEnableOption "the rules-enforcer script";

  config = lib.mkIf config.zeh.ai.tools.rules-enforcer.enable {
    users.users.${config.zeh.ai.username}.packages = [ (pkgs.callPackage ./package.nix { }) ];
  };
}
