---
name: distill-skills
description: "Analyze past sessions on this repository and distill debugging gotchas into skills. Use when asked to mine session history for repeatable tasks, create skills from lessons learned, or capture gotchas discovered through debugging."
---

# Distill Skills

Analyze past work sessions on THIS repository and create agent skills for repeatable tasks, where each skill's core value is the **gotchas**: knowledge the agent did NOT have when the task started and only acquired through debugging. A future agent doing the same task must skip the debugging and go straight to the working approach.

Focus scope: $ARGUMENTS (if empty: all recent sessions for the current repository).

## ⚠️ Quality Bar — Read This First

The cost of a bad skill is higher than the cost of no skill: it pollutes context and erodes trust in the good ones.

- **Every gotcha must cite evidence** — a session file, commit, or transcript excerpt it was extracted from. No evidence, no gotcha. Never invent or generalize beyond what the evidence shows.
- **No obvious knowledge.** If a competent engineer using this stack would already know it, it is not a gotcha.
- **Prefer extending an existing skill** over creating a new one. Do not create overlapping skills.
- **Default to fewer, sharper skills.** Three excellent gotchas in one skill beat ten thin ones across three skills.

## Phase 1 — Gather Evidence

1. Locate past session transcripts for this repository. Check the harness's own store first:
   - pi: `~/.pi/agent/sessions/` — one directory per project cwd, with `/` encoded as `--` (e.g. `/home/user/Workspace/foo` → `--home-user-Workspace-foo--`). Each session is a JSONL file; messages, tool calls, and tool results are lines.
   - Claude Code: `~/.claude/projects/<slugified-repo-path>/`
   - opencode: `~/.local/share/opencode/storage/`
2. Session files are large. Sample efficiently: list the most recent 10–20 sessions, then grep for debugging signals (error messages, `git checkout --` restores, repeated edits to the same file, "actually", "instead", "the fix is") and read the surrounding context.
3. Supplement with (never skip evidence entirely):
   - `git log` — fix/debug/revert commits and their diffs
   - `AGENTS.md` / `CLAUDE.md` lessons-learned sections (to de-dupe later)
   - PR/commit messages describing failed attempts

## Phase 2 — Identify Skill Candidates

A task qualifies only if ALL hold:
- **Repeatable**: performed 2+ times across sessions, or clearly recurring in this repo (same task type, different targets).
- **Has a genuine gotcha**: a non-obvious fact, constraint, or tool behavior that was NOT known at task start, was discovered through debugging (errors, failed attempts, surprising behavior), and would bite again next time.
- **Cost something**: failed builds, wrong first approach, multiple debug cycles, or significant time.

Reject candidates that fail any criterion — list them with one-line reasons. Also reject anything already fully covered by an existing skill or repo doc.

## Phase 3 — Extract Gotchas

For each candidate, extract from the evidence:
- **Trigger**: how the task appears (phrases a user would use, file types involved).
- **Wrong first approach**: what was tried initially and why it failed (actual error/symptom).
- **The debugging trail**: error → hypothesis → actual fix, condensed to 1–3 lines.
- **The gotcha as a rule**: imperative form, e.g. "Wrap interpolated paths in `lib.escapeShellArg` in activation scripts — unescaped paths with spaces break silently."
- **Verification**: the exact command/check that proves the fix (test, eval, build).

## Phase 4 — Create the Skills

1. Inventory existing skills first: repo-local `.agents/skills/`, user `~/.pi/agent/skills/`, and `~/Workspace/zeh-ai-tooling/catalog/skills/`. Extend one of those if the gotchas fit; only then create new.
2. Choose the target:
   - **Repo-specific knowledge** → `.agents/skills/<name>/SKILL.md` in this repository. Discovered live by pi/opencode; no rebuild needed.
   - **Cross-repo generic knowledge** → `~/Workspace/zeh-ai-tooling/catalog/skills/<category>/<name>/SKILL.md`. Requires a rebuild to materialize.
3. Write `SKILL.md`:
   - YAML frontmatter: `name` and `description` only. The description is the trigger — state WHAT it does and WHEN to use it (trigger phrases/contexts).
   - Body: imperative form, under ~200 lines. Per gotcha: **Rule → Why (1–2 line debugging story) → Verify (command)**.
   - Bundled scripts/reference docs go in `scripts/` / `references/` inside the skill dir, linked from SKILL.md.
   - Assume the reader is a competent engineer who lacks THIS repo's (and toolchain's) tribal knowledge. Only non-obvious content.
4. If targeting the catalog: follow sibling skill structure exactly, keep `name` matching the directory name.

## Phase 5 — Report

Deliver, in this order:
1. **Sessions analyzed** — count and date range.
2. **Skills created/updated** — table: name, target path, trigger, gotchas captured, evidence source for each gotcha.
3. **Rejected candidates** — one-line reason each.
4. **Highest-value gotcha found** — one sentence.
5. If skills were added to the zeh-ai-tooling catalog, note that a rebuild is required; if repo-local, note they are live immediately.

Do not delete or rewrite existing skills beyond the minimum additions needed.
