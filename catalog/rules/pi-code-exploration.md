---
harnesses: [pi]
---

## Code exploration

When codegraph_explore is available it overrides the default "use bash for ls, rg, find" rule for understanding code: answer how/where/what-calls questions with codegraph_explore (or codegraph_node for one symbol) first, and use grep/rg only for literal text (error messages, config keys) or after codegraph reports a missing index.
