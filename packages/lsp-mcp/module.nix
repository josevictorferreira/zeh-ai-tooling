# Tool: config for `language-server-mcp` (the `lsp` MCP server).
#
# The MCP server resolves a language-server command in this order:
#   configured `command` -> system PATH -> cached managed install -> download.
# Downloads of prebuilt archives do not run on NixOS (wrong dynamic linker), so
# servers that are not in the MCP server's built-in registry get an explicit
# store-path command here. Registry built-ins (gopls, rust-analyzer,
# typescript-language-server, ...) already resolve from PATH.
_:
{ config
, lib
, pkgs
, ...
}:
{
  options.zeh.ai.tools.lsp-mcp.enable = lib.mkEnableOption "the language-server-mcp config";

  config = lib.mkIf config.zeh.ai.tools.lsp-mcp.enable {
    zeh.ai.home.".config/lsp-mcp/config.json" = {
      kind = "file";
      mode = "copy";
      json = {
        lsp.servers = {
          # Not a built-in registry entry, so declared as a custom stdio
          # server. `.lua` deliberately excluded -- it belongs to lua_ls.
          luau-lsp = {
            command = lib.getExe pkgs.luau-lsp;
            args = [ "lsp" ];
            languageIds = [ "luau" ];
            extensions = [ ".luau" ];
          };
        };
      };
    };
  };
}
