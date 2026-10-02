# Tool: prompt-enhancer script, installed into the user's packages.
_:
{ config
, lib
, pkgs
, ...
}:
{
  options.zeh.ai.tools.prompt-enhancer.enable = lib.mkEnableOption "the prompt-enhancer script";

  config = lib.mkIf config.zeh.ai.tools.prompt-enhancer.enable {
    users.users.${config.zeh.ai.username}.packages = [ (pkgs.callPackage ./package.nix { }) ];
  };
}
