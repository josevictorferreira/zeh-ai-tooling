# Renderers shared by several harnesses: catalog item -> file contents.
# Each `mk*Configs` returns { "<relative path>" = <string | path>; } for a
# harness config directory (see ./files.nix).
{ lib }:
let
  transformMcpOptions =
    _program: base:
    if builtins.isAttrs base && base ? command && builtins.isList base.command then
      # A list command is split into command string + args list
      base
      // {
        command = builtins.head base.command;
        args = (builtins.tail base.command) ++ (base.args or [ ]);
      }
    else
      base;

  formatPermissions =
    perms: indent:
    let
      formatValue =
        key: value:
        if builtins.isString value then
          "${indent}\"${key}\": \"${value}\""
        else if builtins.isAttrs value then
          "${indent}\"${key}\":\n${formatPermissions value "${indent}  "}"
        else
          "";
    in
    lib.concatStringsSep "\n" (lib.mapAttrsToList formatValue perms);

  # Agent / command -> Claude Code markdown (also used by command-code commands)
  toClaudeMarkdownPrompt =
    value:
    let
      allTools = lib.unique (value.tools or [ ]);
      toolsString = lib.concatStringsSep ", " allTools;
      headerLines = [
        "name: \"${value.name or "unknown"}\""
        "description: \"${value.description or ""}\""
      ]
      ++ lib.optional (allTools != [ ]) "allowed-tools: \"${toolsString}\""
      ++ lib.optional ((value.agent or "") != "") "agent: ${value.agent}"
      ++ lib.optional ((value.model or "") != "") "model: ${value.model}"
      ++ lib.optional ((value.temperature or null) != null) "temperature: ${toString value.temperature}";
    in
    "---\n" + lib.concatStringsSep "\n" headerLines + "\n---\n" + value.prompt;

  # Agent / command -> opencode markdown
  toOpencodeMarkdownPrompt =
    value:
    let
      allTools = lib.unique (value.tools or [ ]);
      disabledTools = value.disabledTools or [ ];
      permission = value.permission or { };
      headerLines = [
        "name: \"${value.name or "unknown"}\""
        "description: \"${value.description or ""}\""
        "mode: \"${value.mode or "subagent"}\""
      ]
      ++ lib.optional (permission != { }) "permission:"
      ++ lib.optionals (permission != { }) (
        lib.mapAttrsToList
          (
            key: perm:
            if builtins.isString perm then
              "  \"${key}\": \"${perm}\""
            else if builtins.isAttrs perm then
              "  \"${key}\":\n${formatPermissions perm "    "}"
            else
              ""
          )
          permission
      )
      ++ lib.optional (allTools != [ ]) "tools:"
      ++ lib.optionals (allTools != [ ]) (
        (map (tool: "  ${lib.toLower tool}*: true") allTools)
        ++ (map (tool: "  ${lib.toLower tool}*: false") disabledTools)
      )
      ++ lib.optional ((value.agent or "") != "") "agent: ${value.agent}"
      ++ lib.optional ((value.model or "") != "") "model: ${value.model}"
      ++ lib.optional ((value.temperature or null) != null) "temperature: ${toString value.temperature}";
    in
    "---\n" + lib.concatStringsSep "\n" headerLines + "\n---\n" + value.prompt;

  # Skill -> SKILL.md (frontmatter regenerated for every harness)
  toSkillMarkdown =
    skillName: skill:
    let
      allowedToolsYaml =
        if (skill.allowed-tools or [ ]) != [ ] then
          "allowed-tools:\n" + lib.concatMapStringsSep "\n" (tool: "  - ${tool}*") skill.allowed-tools
        else
          "";

      formatMcp =
        mcp: indent:
        let
          formatValue =
            name: cfg:
            let
              cfgCommand = cfg.command or "";
              commandStr = if builtins.isList cfgCommand then builtins.head cfgCommand else cfgCommand;
              cfgArgs = cfg.args or [ ];
              argsList = if builtins.isList cfgArgs then cfgArgs else [ cfgArgs ];
              commandLine = "command: \"${commandStr}\"";
              argsLine =
                if argsList != [ ] then
                  "\n${indent}  args:\n" + (lib.concatStringsSep "\n" (map (arg: "${indent}    - \"${arg}\"") argsList))
                else
                  "";
              envStr =
                if (cfg.env or { }) != { } then
                  "\n${indent}  env:\n"
                  + (lib.concatStringsSep "\n" (lib.mapAttrsToList (k: v: "${indent}    ${k}: \"${v}\"") cfg.env))
                else
                  "";
            in
            "${indent}${name}:\n${indent}  ${commandLine}${argsLine}${envStr}";
        in
        "mcp:\n" + (lib.concatStringsSep "\n" (lib.mapAttrsToList formatValue mcp));

      mcpYaml = if (skill.mcp or { }) != { } then formatMcp skill.mcp "  " else "";

      formatMetadata =
        metadata:
        let
          formatValue =
            key: v: "  ${key}: \"${if lib.isList v then lib.concatStringsSep ", " (map toString v) else (toString v)}\"";
        in
        "metadata:\n" + (lib.concatStringsSep "\n" (lib.mapAttrsToList formatValue metadata));

      metadataYaml = if (skill.metadata or { }) != { } then formatMetadata skill.metadata else "";

      license = skill.license or "";

      descriptionLine =
        let
          desc = skill.description or "";
        in
        if builtins.match ".*[\n].*" desc != null then
          "description: >\n" + lib.concatStringsSep "\n" (map (line: "  ${line}") (lib.splitString "\n" desc))
        else
          "description: \"${builtins.replaceStrings [ "\"" ] [ "\\\"" ] desc}\"";

      headerLines = [
        "name: \"${skillName}\""
        descriptionLine
      ]
      ++ lib.optional ((skill.model or "") != "") "model: ${skill.model}"
      ++ lib.optional (license != "") "license: \"${license}\""
      ++ lib.optional (metadataYaml != "") metadataYaml
      ++ lib.optional (allowedToolsYaml != "") allowedToolsYaml
      ++ lib.optional (mcpYaml != "") mcpYaml
      ++ [ "compatibility: opencode" ];
    in
    "---\n" + lib.concatStringsSep "\n" headerLines + "\n---\n" + "\n" + (skill.prompt or "");

  # Skill -> { "<dir>/<name>/SKILL.md" = …; "<dir>/<name>/<file>" = …; }
  mkSkillFiles =
    dir: skillName: skill:
    {
      "${dir}/${skillName}/SKILL.md" = toSkillMarkdown skillName skill;
    }
    // lib.mapAttrs' (rel: content: lib.nameValuePair "${dir}/${skillName}/${rel}" content) (skill.files or { });

  mkSkillsIn = dir: skills: lib.foldl' (acc: n: acc // mkSkillFiles dir n skills.${n}) { } (builtins.attrNames skills);

  mkMdConfigs =
    toMd: prefix: attrset:
    lib.mapAttrs' (name: value: lib.nameValuePair "${prefix}/${name}.md" (toMd value)) attrset;

  escapeTomlString = str: builtins.replaceStrings [ "\\" "\"" "\n" "\t" ] [ "\\\\" "\\\"" "\\n" "\\t" ] str;

  # !`cmd` -> !{cmd} (Gemini CLI shell-injection syntax)
  replaceBacktickToolSyntax =
    str:
    lib.concatMapStrings (part: if builtins.isList part then "!{${builtins.elemAt part 0}}" else part) (
      builtins.split "!`([^`]*)`" str
    );

  # $1, $2, … -> {{args}}
  replaceNumberedArgs =
    str: lib.concatMapStrings (part: if builtins.isList part then "{{args}}" else part) (builtins.split "\\$[0-9]+" str);

  transformGeminiPrompt =
    str: replaceBacktickToolSyntax (replaceNumberedArgs (builtins.replaceStrings [ "$ARGUMENTS" ] [ "{{args}}" ] str));

  toGeminiToml =
    value:
    let
      description = value.description or "";
      descriptionLine = if description != "" then "description = \"${escapeTomlString description}\"\n\n" else "";
    in
    descriptionLine + "prompt = \"\"\"\n${transformGeminiPrompt (value.prompt or "")}\n\"\"\"";
in
{
  inherit
    transformMcpOptions
    toClaudeMarkdownPrompt
    toOpencodeMarkdownPrompt
    toSkillMarkdown
    toGeminiToml
    ;

  mkClaudecodeMdConfigs = mkMdConfigs toClaudeMarkdownPrompt;
  mkOpencodeMdConfigs = mkMdConfigs toOpencodeMarkdownPrompt;
  # skills/<name>/… (Agent Skills layout) and skill/<name>/… (gemini)
  mkSkillsConfigs = mkSkillsIn "skills";
  mkSkillConfigs = mkSkillsIn "skill";
  mkGeminiTomlConfigs =
    attrset: lib.mapAttrs' (name: value: lib.nameValuePair "commands/${name}.toml" (toGeminiToml value)) attrset;
}
