# Pure-Nix parser for the YAML subset used in catalog frontmatter.
#
# Supported:
#   - block mappings (any depth), plain or quoted keys
#   - block sequences of scalars (`- item`), at the key's indent or deeper
#   - flow sequences of scalars (`[a, "b c"]`) and flat flow mappings (`{ a: 1 }`)
#   - scalars: plain, "double-quoted" (JSON escapes), 'single-quoted' ('' escape),
#     true/false, null/~, integers and floats
#   - literal (`|`) and folded (`>`) block scalars, with `-`/`+` chomping
#   - `#` comments (full-line, or after whitespace following a value)
#
# Anything else (anchors, tags, multi-document, sequences of mappings) throws.
{ lib }:
let
  inherit (builtins)
    elemAt
    length
    match
    substring
    stringLength
    ;

  fail = msg: throw "catalog yaml: ${msg}";

  trim =
    s:
    let
      m = match "[[:space:]]*(.*[^[:space:]])[[:space:]]*" s;
    in
    if m == null then "" else elemAt m 0;

  indentOf = s: stringLength (elemAt (match "( *).*" s) 0);

  isBlank = s: match "[[:space:]]*(#.*)?" s != null;

  # Drop a trailing ` # comment` from an unquoted value.
  stripComment =
    s:
    let
      m = match "(.*[^[:space:]])[[:space:]]+#.*" s;
    in
    trim (if m == null then (if lib.hasPrefix "#" (trim s) then "" else s) else elemAt m 0);

  # Double-quoted string body -> value (JSON-compatible escapes).
  unescapeDouble = body: builtins.fromJSON "\"${body}\"";

  unescapeSingle = body: builtins.replaceStrings [ "''" ] [ "'" ] body;

  dqRe = "\"((\\\\.|[^\"\\\\])*)\"";
  sqRe = "'(([^']|'')*)'";

  plainScalar =
    s:
    if s == "true" then
      true
    else if s == "false" then
      false
    else if s == "null" || s == "~" || s == "" then
      null
    else if match "-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][-+]?[0-9]+)?" s != null then
      builtins.fromJSON s
    else if match "[&*!|>%@`].*" s != null then
      fail "unsupported plain scalar `${s}`"
    else
      s;

  # Parse one inline value: quoted, flow collection, or plain scalar.
  parseInline =
    raw:
    let
      s = trim raw;
      dq = match "${dqRe}[[:space:]]*(#.*)?" s;
      sq = match "${sqRe}[[:space:]]*(#.*)?" s;
      flowSeq = match "[[](.*)[]][[:space:]]*(#.*)?" s;
      flowMap = match "[{](.*)[}][[:space:]]*(#.*)?" s;
    in
    if dq != null then
      unescapeDouble (elemAt dq 0)
    else if sq != null then
      unescapeSingle (elemAt sq 0)
    else if flowSeq != null then
      map parseInline (splitFlow (elemAt flowSeq 0))
    else if flowMap != null then
      lib.listToAttrs (
        map
          (
            entry:
            let
              kv = splitKey entry;
            in
            if kv == null then fail "bad flow mapping entry `${entry}`" else lib.nameValuePair kv.key (parseInline kv.rest)
          )
          (splitFlow (elemAt flowMap 0))
      )
    else
      plainScalar (stripComment s);

  # Split the inside of a flow collection on top-level commas (quote-aware).
  splitFlow =
    inner:
    let
      go =
        rest: acc:
        let
          r = trim rest;
          item = match "(${dqRe}|${sqRe}|[^,\"']*)[[:space:]]*(,(.*))?" r;
        in
        if r == "" then
          acc
        else if item == null then
          fail "bad flow collection `[${inner}]`"
        else
          let
            tok = trim (elemAt item 0);
            more = elemAt item 6;
            acc' = acc ++ [ tok ];
          in
          if more == null then acc' else go more acc';
    in
    go inner [ ];

  # `key: rest` -> { key, rest } (rest may be ""), or null when not a mapping line.
  splitKey =
    line:
    let
      s = trim line;
      dq = match "${dqRe}[[:space:]]*:([[:space:]](.*))?" s;
      sq = match "${sqRe}[[:space:]]*:([[:space:]](.*))?" s;
      plain = match "([^\"'#:[:space:]-][^:#]*[^:[:space:]]|[^\"'#:[:space:]-])[[:space:]]*:([[:space:]](.*))?" s;
      rest = m: i: if elemAt m i == null then "" else elemAt m i;
    in
    if dq != null then
      {
        key = unescapeDouble (elemAt dq 0);
        rest = rest dq 3;
      }
    else if sq != null then
      {
        key = unescapeSingle (elemAt sq 0);
        rest = rest sq 3;
      }
    else if plain != null then
      {
        key = elemAt plain 0;
        rest = rest plain 2;
      }
    else
      null;

  isSeqLine = s: match "-([[:space:]].*)?" (trim s) != null;

  parse =
    text:
    let
      lines = lib.splitString "\n" text;
      n = length lines;
      line = i: elemAt lines i;

      # First non-blank line index at or after i.
      nextContent =
        i:
        if i >= n then
          n
        else if isBlank (line i) then
          nextContent (i + 1)
        else
          i;

      # Block scalar starting after line i (exclusive) for a key at `parentIndent`.
      blockScalar =
        i: parentIndent: style:
        let
          collect =
            j: acc:
            if j >= n then
              {
                inherit acc;
                next = j;
              }
            else
              let
                l = line j;
              in
              if trim l == "" then
                collect (j + 1) (acc ++ [ "" ])
              else if indentOf l > parentIndent then
                collect (j + 1) (acc ++ [ l ])
              else
                {
                  inherit acc;
                  next = j;
                };
          got = collect (i + 1) [ ];
          contentLines = lib.filter (l: l != "") got.acc;
          ind = if contentLines == [ ] then 0 else lib.foldl' lib.min 1000 (map indentOf contentLines);
          dedented = map (l: if l == "" then "" else substring ind (-1) l) got.acc;
          # Trailing blank lines are separated from the content for chomping.
          stripTrailing = ls: if ls != [ ] && lib.last ls == "" then stripTrailing (lib.init ls) else ls;
          body = stripTrailing dedented;
          trailing = length dedented - length body;
          folded =
            let
              step =
                acc: l:
                if acc == null then
                  l
                else if l == "" then
                  acc + "\n"
                else if lib.hasSuffix "\n" acc then
                  acc + l
                else
                  acc + " " + l;
            in
            lib.foldl' step null body;
          joined = if style.fold then (if folded == null then "" else folded) else lib.concatStringsSep "\n" body;
          value =
            if body == [ ] then
              ""
            else if style.chomp == "-" then
              joined
            else if style.chomp == "+" then
              joined + lib.concatStrings (lib.replicate (trailing + 1) "\n")
            else
              joined + "\n";
        in
        {
          inherit value;
          inherit (got) next;
        };

      blockStyle =
        rest:
        let
          m = match "([|>])([-+]?)[[:space:]]*(#.*)?" (trim rest);
        in
        if m == null then
          null
        else
          {
            fold = elemAt m 0 == ">";
            chomp = elemAt m 1;
          };

      # Parse the node starting at the first content line >= i.
      parseNode =
        i:
        let
          j = nextContent i;
        in
        if j >= n then
          {
            value = null;
            next = j;
          }
        else if isSeqLine (line j) then
          parseSeq j (indentOf (line j))
        else
          parseMap j (indentOf (line j));

      parseSeq =
        i: indent:
        let
          go =
            j: acc:
            let
              k = nextContent j;
            in
            if k >= n || indentOf (line k) != indent || !isSeqLine (line k) then
              {
                value = acc;
                next = k;
              }
            else
              let
                item = trim (lib.removePrefix "-" (trim (line k)));
              in
              if item == "" then
                fail "nested block inside a sequence item is not supported (line ${toString (k + 1)})"
              else if splitKey item != null && match "[\"'[{].*" item == null then
                fail "mappings inside sequences are not supported (line ${toString (k + 1)}: `${item}`)"
              else
                go (k + 1) (acc ++ [ (parseInline item) ]);
        in
        go i [ ];

      parseMap =
        i: indent:
        let
          go =
            j: acc:
            let
              k = nextContent j;
            in
            if k >= n || indentOf (line k) < indent then
              {
                value = acc;
                next = k;
              }
            else if indentOf (line k) > indent then
              fail "unexpected indentation at line ${toString (k + 1)}: `${line k}`"
            else if isSeqLine (line k) then
              {
                value = acc;
                next = k;
              }
            else
              let
                kv = splitKey (line k);
                style = blockStyle kv.rest;
                restValue = stripComment kv.rest;
                child =
                  if style != null then
                    blockScalar k indent style
                  else if restValue != "" then
                    {
                      value = parseInline kv.rest;
                      next = k + 1;
                    }
                  else
                    let
                      c = nextContent (k + 1);
                    in
                    if c < n && (indentOf (line c) > indent || (indentOf (line c) == indent && isSeqLine (line c))) then
                      parseNode c
                    else
                      {
                        value = null;
                        next = k + 1;
                      };
              in
              if kv == null then
                fail "expected `key: value` at line ${toString (k + 1)}: `${line k}`"
              else if acc ? ${kv.key} then
                fail "duplicate key `${kv.key}` at line ${toString (k + 1)}"
              else
                go child.next (acc // { ${kv.key} = child.value; });
        in
        go i { };

      result = parseNode 0;
      leftover = nextContent result.next;
    in
    if leftover < n then
      fail "could not parse line ${toString (leftover + 1)}: `${line leftover}`"
    else if result.value == null then
      { }
    else
      result.value;
in
{
  inherit parse parseInline;
}
