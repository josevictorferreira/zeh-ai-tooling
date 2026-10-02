# Build a harness config directory from { "<relative path>" = value; }.
#   string     -> pkgs.writeText "<prefix>-<path with / as ->"
#   attrset    -> serialized by file extension (json, yaml, toml, …), then writeText
#   derivation -> used as-is
#   path       -> copied to the store as-is
{ lib, pkgs, generators }:
{
  mkConfigDir =
    { name, prefix }:
    files:
    pkgs.linkFarm name (
      lib.mapAttrsToList
        (
          fileName: value:
          let
            storeName = "${prefix}-${builtins.replaceStrings [ "/" ] [ "-" ] fileName}";
          in
          {
            name = fileName;
            path =
              if lib.isDerivation value then
                value
              else if builtins.isString value then
                pkgs.writeText storeName value
              else if builtins.isAttrs value then
                pkgs.writeText storeName (generators.toFileFormatStr (lib.last (lib.splitString "." fileName)) value)
              else
                value;
          }
        )
        files
    );
}
