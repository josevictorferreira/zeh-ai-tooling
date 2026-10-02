---
name: architect
description: "Systems \"architect\": long-term # not comment"
mode: primary   # comment
temperature: 0.2
enable: false
count: 3
tools: [Read, "Glob x", 'it''s']
empty: []
list:
  - Bash(git *)
  - "quoted: item"
same-indent:
- a
- b
permission:
  "*": ask
  bash:
    "git *": allow
    rm: deny
overrides:
  opencode: { temperature: 0.2, mode: subagent }
lit: |
  line one
    indented

  line three
fold: >-
  folded
  text
nothing:
---

# Body
---
more
