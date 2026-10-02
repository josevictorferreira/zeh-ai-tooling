---
name: "sample-agent"
description: "Agent used by the render snapshot tests"
mode: "subagent"
permission:
  "bash":
    "*": "ask"
    "git *": "allow"
  "edit": "allow"
tools:
  read*: true
  grep*: true
  bash*: true
  task*: false
temperature: 0.100000
---
# Sample Agent

Run `$ARGUMENTS` and !`git status`, then $1.
