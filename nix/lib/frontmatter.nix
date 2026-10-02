# Split a Markdown document into YAML frontmatter and body.
#
#   ---            <- first line
#   key: value     <- parsed with ./yaml.nix
#   ---            <- first `---` line after the opening one
#                  <- one blank line here is optional and dropped
#   # Body …
#
# A document that does not start with `---` has no frontmatter: { attrs = { }; body = text; }.
{ lib, yaml }:
let
  parse =
    text:
    let
      lines = lib.splitString "\n" text;
      closing = lib.lists.findFirstIndex (l: l == "---") null (lib.drop 1 lines);
    in
    if !(lib.hasPrefix "---\n" text) then
      {
        attrs = { };
        body = text;
      }
    else if closing == null then
      throw "catalog frontmatter: missing closing `---`"
    else
      let
        fmLines = lib.sublist 1 closing lines;
        rest = lib.concatStringsSep "\n" (lib.drop (closing + 2) lines);
      in
      {
        attrs = yaml.parse (lib.concatStringsSep "\n" fmLines);
        body = if lib.hasPrefix "\n" rest then lib.removePrefix "\n" rest else rest;
      };

  parseFile = path: parse (builtins.readFile path);
in
{
  inherit parse parseFile;
}
