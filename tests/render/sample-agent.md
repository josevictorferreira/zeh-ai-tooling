---
name: sample-agent
description: Agent used by the render snapshot tests
mode: subagent
temperature: 0.1
tools: [Read, Grep, Bash]
disabledTools: [Task]
permission:
  edit: allow
  bash:
    "*": ask
    "git *": allow
---

# Sample Agent

Run `$ARGUMENTS` and !`git status`, then $1.
