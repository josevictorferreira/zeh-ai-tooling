import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { access, readFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { registerChild } from "./child";
import {
  appendInbox,
  descendantsOf,
  isTerminal,
  listRoots,
  listTree,
  newTaskId,
  readResult,
  readTask,
  removeTask,
  resolveTaskId,
  shortId,
  updateTask,
  writeSystemPrompt,
  writeTask,
  type TaskRecord,
} from "./state";
import { killPane, killSessionIfEmpty, listPanes, serverEnvironment, sessionName, shellQuote, spawnPane, type Exec } from "./tmux";
import { buildSystemPrompt, BUILTIN_TYPES, describeType, resolveSkills, resolveType } from "./types";

// Subagents: delegate work to separate interactive `pi` processes in tmux
// panes. Every Pi process gets the launcher role (tools + /subagents); a
// process started by subagent_launch additionally gets the child role, which
// reports its turns back through the shared task files. See README.md.

const POLL_MS = 1500;
/** Poll interval while every open task is idle (waiting for its launcher). */
const IDLE_POLL_MS = 10_000;
const HANDBACK_CAP = 16 * 1024;
const CHECK_CAP = 64 * 1024;
const CLOSE_WAIT_MS = 3000;
const WAIT_DEFAULT_S = 600;
const WAIT_MAX_S = 3600;
// Set per pane by the launcher or by tmux itself; never forwarded from the launcher.
const NOT_FORWARDED = /^(PI_SUBAGENT_.*|TMUX|TMUX_PANE|TERM|TERM_PROGRAM|TERM_PROGRAM_VERSION|SHLVL|PWD|OLDPWD|_)$/;

function text(message: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text: message }], details };
}

function fail(message: string) {
  return text("subagents: " + message, { error: message });
}

/**
 * Extra `-e` for the child when Pi would not discover this extension there on
 * its own: discovery covers <agentDir>/extensions, installed packages under
 * <agentDir>, and <cwd>/.pi/extensions; a repo checkout loaded with `-e` is
 * not covered. Pi dedupes extension paths by string, so passing `-e` for a
 * discoverable copy would load (and register) everything twice. When a copy is
 * also installed, the launcher itself can only have started with `-ne` (both
 * copies would conflict), so the child mirrors that.
 */
async function childExtensionArgs(cwd: string): Promise<string[]> {
  const own = fileURLToPath(import.meta.url);
  const discovered = [resolve(getAgentDir(), "extensions"), join(resolve(cwd), ".pi", "extensions")];
  if (discovered.some((dir) => own.startsWith(dir + "/")) || own.startsWith(resolve(getAgentDir()) + "/")) return [];
  for (const dir of discovered) {
    try {
      await access(join(dir, "subagents", "index.ts"));
      return ["-ne", "-e", own];
    } catch {
      // no installed copy here
    }
  }
  return ["-e", own];
}

async function findOnPath(binary: string): Promise<string | undefined> {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, binary);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

/** Last `limit` tool calls recorded in a child's session file, as "name(args)". */
async function toolCallTail(sessionFile: string | undefined, limit: number): Promise<string[]> {
  if (!sessionFile) return [];
  let raw: string;
  try {
    raw = await readFile(sessionFile, "utf8");
  } catch {
    return [];
  }
  const calls: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
    for (const block of entry.message.content) {
      if (block?.type !== "toolCall") continue;
      const args = JSON.stringify(block.arguments ?? {});
      calls.push(block.name + "(" + (args.length > 80 ? args.slice(0, 77) + "..." : args) + ")");
    }
  }
  return calls.slice(-limit);
}

/**
 * Launcher variables the pane would not get: tmux starts panes from its
 * server's environment, which may predate the shell that set API keys. With no
 * server running, tmux starts one from this process's environment, so nothing
 * needs forwarding.
 */
async function forwardedEnv(exec: Exec): Promise<Record<string, string>> {
  const server = await serverEnvironment(exec);
  if (!server) return {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || NOT_FORWARDED.test(key) || server.get(key) === value) continue;
    env[key] = value;
  }
  return env;
}

function describe(t: TaskRecord): string {
  return shortId(t.id) + " " + t.type + " \"" + t.title + "\" " + t.status + " turns=" + t.turns +
    (t.model ? " " + t.model : "") + (t.fellBack ? " (fell back)" : "") + (t.retried ? " (retried)" : "");
}

export default function (pi: ExtensionAPI) {
  const childTaskId = process.env.PI_SUBAGENT_TASK;
  const envRoot = process.env.PI_SUBAGENT_ROOT;
  if (childTaskId && envRoot) registerChild(pi, childTaskId, envRoot);

  const exec: Exec = (command, args, options) => pi.exec(command, args, options);
  const rootOf = (ctx: ExtensionContext) => envRoot ?? ctx.sessionManager.getSessionId();
  const mine = (ctx: ExtensionContext, tree: TaskRecord[]) =>
    tree.filter((t) => t.parentSessionId === ctx.sessionManager.getSessionId());

  // ---- poller: watches this process's tasks and hands finished turns back ----
  const handed = new Map<string, number>(); // taskId -> last turn handed back
  const waited = new Map<string, number>(); // taskId -> active subagent_wait calls covering it
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ticking = false;
  let pollCtx: ExtensionContext | undefined;
  // Stay on the fast interval this long after a launch or send, until the child has picked the work up.
  let fastUntil = 0;

  interface Ready {
    task: TaskRecord;
    note: string;
    /** false when the task exited after its last result was already delivered. */
    fresh: boolean;
  }

  /** A task's turn or exit that has not been handed back yet; marks it handed. */
  async function takeReady(cwd: string, root: string, t: TaskRecord, panes: Set<string>): Promise<Ready | undefined> {
    const last = handed.get(t.id) ?? 0;
    if (t.status === "idle" && t.turns > last) {
      handed.set(t.id, t.turns);
      return { task: t, note: "finished turn " + t.turns, fresh: true };
    }
    if (t.paneId && !panes.has(t.paneId)) {
      const everHanded = handed.has(t.id);
      const updated = (await updateTask(cwd, root, t.id, { status: "exited" })) ?? { ...t, status: "exited" as const };
      handed.set(t.id, updated.turns);
      if (updated.turns > last) return { task: updated, note: "finished turn " + updated.turns + " and exited", fresh: true };
      if (!everHanded) return { task: updated, note: "exited before finishing a turn", fresh: true };
      return { task: updated, note: "exited without a new result", fresh: false };
    }
    return undefined;
  }

  async function formatReady(cwd: string, r: Ready): Promise<string> {
    const t = r.task;
    const header = "subagent " + t.type + " \"" + t.title + "\" (" + shortId(t.id) + ") " + r.note +
      (t.lastStopReason === "error" ? " [stopReason: error]" : "") + (t.fellBack ? " [fell back to " + t.model + "]" : "") +
      (t.retried ? " [retried once]" : "");
    const result = r.fresh
      ? (await readResult(cwd, t.rootSessionId, t.id, HANDBACK_CAP)) ?? "(no result written)"
      : "(its last result was already delivered; subagent_check " + shortId(t.id) + " shows it again)";
    const footer = isTerminal(t.status)
      ? "The subagent has exited; call subagent_close to clear it from the tree."
      : "The subagent is still open: reply with subagent_send to continue it, or subagent_close when done.";
    return header + "\n\n" + result + "\n\n" + footer;
  }

  async function handBack(cwd: string, r: Ready): Promise<void> {
    const t = r.task;
    await pi.sendMessage(
      {
        customType: "subagent-result",
        display: true,
        content: await formatReady(cwd, r),
        details: { taskId: t.id, type: t.type, title: t.title, status: t.status, turns: t.turns, model: t.model },
      },
      { deliverAs: "steer", triggerTurn: true },
    );
  }

  async function openTasks(ctx: ExtensionContext): Promise<TaskRecord[]> {
    return mine(ctx, await listTree(ctx.cwd, rootOf(ctx))).filter((t) => !isTerminal(t.status));
  }

  async function tick(): Promise<void> {
    timer = undefined;
    const ctx = pollCtx;
    if (!ctx || ticking) return;
    ticking = true;
    let next: number | undefined = POLL_MS;
    try {
      const root = rootOf(ctx);
      const tasks = await openTasks(ctx);
      if (tasks.length === 0) {
        next = undefined;
        return;
      }
      const panes = await listPanes(exec, sessionName(root));
      for (const t of tasks) {
        if (waited.has(t.id)) continue; // subagent_wait returns it instead
        const ready = await takeReady(ctx.cwd, root, t, panes);
        if (ready) await handBack(ctx.cwd, ready);
      }
      // Idle tasks only change when their launcher sends them something, and
      // subagent_send restarts the fast poll; a closed pane is still noticed.
      if (Date.now() > fastUntil && tasks.every((t) => t.status === "idle" && (handed.get(t.id) ?? 0) >= t.turns)) {
        next = IDLE_POLL_MS;
      }
    } catch {
      // a failed tick is retried on the next one
    } finally {
      ticking = false;
      if (next !== undefined && !timer) timer = setTimeout(tick, next);
    }
  }

  function startPoller(ctx: ExtensionContext): void {
    pollCtx = ctx;
    fastUntil = Date.now() + 3 * IDLE_POLL_MS;
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, POLL_MS);
  }

  function stopPoller(): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pollCtx = undefined;
  }

  // ---- close: descendants first, then the pane, then the record ----
  async function closeTask(ctx: ExtensionContext, t: TaskRecord, tree: TaskRecord[]): Promise<string[]> {
    const closed: string[] = [];
    for (const d of descendantsOf(tree, t.id)) {
      if (d.status !== "closed") closed.push(...(await closeTask(ctx, d, [])));
    }
    if (t.paneId && t.status !== "closed") {
      await killPane(exec, t.paneId);
      const deadline = Date.now() + CLOSE_WAIT_MS;
      while (Date.now() < deadline && (await listPanes(exec, sessionName(t.rootSessionId))).has(t.paneId)) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    await updateTask(ctx.cwd, t.rootSessionId, t.id, { status: "closed", closedAt: new Date().toISOString() });
    handed.set(t.id, Number.MAX_SAFE_INTEGER);
    closed.push(shortId(t.id));
    return closed;
  }

  // ---- tools ----
  pi.registerTool({
    name: "subagent_launch",
    label: "Launch subagent",
    description:
      "Start a subagent: a separate interactive pi process in a tmux pane, in this working directory, with a " +
      "type-specific prompt, model and tools. Returns immediately. Each time the subagent finishes a turn, " +
      "its final message is delivered to you as a `subagent-result` message, so do not poll for it. Types: " +
      Object.values(BUILTIN_TYPES).map(describeType).join("; ") + ". A subagent has only its type's tools: " +
      "do not ask an explorer, researcher or oracle to run commands.",
    promptSnippet: "Delegate a bounded task to an explorer, researcher, worker or oracle subagent",
    promptGuidelines: [
      "Use subagent_launch for independent, well-bounded work (recon, research, an implementation slice, a second opinion). Give it everything it needs in the prompt; it does not see your conversation.",
      "Subagent results arrive on their own as subagent-result messages. While a subagent works, continue with independent work, or end your turn: a finished subagent turn starts a new turn for you. If you need the result before you can continue, call subagent_wait. Never sleep in bash or loop on subagent_check to wait.",
      "Close subagents you no longer need with subagent_close; they stay open (and on screen) until you do.",
    ],
    parameters: Type.Object({
      type: Type.String({ minLength: 1, description: "Subagent type: explorer, researcher, worker, oracle, or a user-defined type." }),
      title: Type.String({ minLength: 1, maxLength: 80, description: "Short title shown in the tmux pane and in listings." }),
      prompt: Type.String({ minLength: 1, description: "The complete task for the subagent, self-contained." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      let type;
      let skills: string[] | undefined;
      try {
        type = await resolveType(params.type);
        skills = await resolveSkills(type.skills, ctx.cwd);
      } catch (err) {
        return fail((err as Error).message);
      }
      const [piBin, tmuxBin] = await Promise.all([findOnPath("pi"), findOnPath("tmux")]);
      if (!piBin) return fail("`pi` not found on PATH");
      if (!tmuxBin) return fail("`tmux` not found on PATH");

      const root = rootOf(ctx);
      const id = newTaskId();
      const now = new Date().toISOString();
      const model = type.model ?? (ctx.model ? ctx.model.provider + "/" + ctx.model.id : undefined);
      const record: TaskRecord = {
        id,
        parentSessionId: ctx.sessionManager.getSessionId(),
        rootSessionId: root,
        type: type.name,
        title: params.title,
        prompt: params.prompt,
        model,
        fallbackModel: type.fallbackModel,
        status: "starting",
        turns: 0,
        createdAt: now,
        updatedAt: now,
      };
      let systemFile: string;
      try {
        systemFile = await writeSystemPrompt(ctx.cwd, root, id, buildSystemPrompt(type));
        await writeTask(ctx.cwd, record);
      } catch (err) {
        return fail("cannot write task files: " + (err as Error).message);
      }

      const argv = [
        piBin, "--session-id", id, "-n", type.name + ": " + params.title,
        ...(await childExtensionArgs(ctx.cwd)),
        ...(model ? ["--model", model] : []),
        ...(type.tools ? ["--tools", type.tools.join(",")] : []),
        ...(skills ? ["--no-skills", ...skills.flatMap((p) => ["--skill", p])] : []),
        "--append-system-prompt", systemFile,
        "--", params.prompt,
      ];
      const name = sessionName(root);
      let paneId: string;
      try {
        paneId = await spawnPane(exec, {
          name,
          cwd: ctx.cwd,
          env: {
            ...(await forwardedEnv(exec)),
            PI_SUBAGENT_TASK: id,
            PI_SUBAGENT_ROOT: root,
            PI_SUBAGENT_PARENT: record.parentSessionId,
          },
          command: argv.map(shellQuote).join(" "),
        });
      } catch (err) {
        await removeTask(ctx.cwd, root, id);
        return fail((err as Error).message);
      }
      await updateTask(ctx.cwd, root, id, { paneId });
      startPoller(ctx);
      return text(
        "launched " + type.name + " \"" + params.title + "\" as " + shortId(id) + " in tmux session " + name + " pane " + paneId +
          (model ? " with " + model : "") + ", tools: " + (type.tools ? type.tools.join(", ") : "all") +
          ". Its result will arrive as a subagent-result message.",
        { taskId: id, paneId, tmuxSession: name, model, tools: type.tools },
      );
    },
  });

  pi.registerTool({
    name: "subagent_check",
    label: "Check subagents",
    description:
      "Status of the subagents you launched: one line each, or the full detail of one task (status, model, " +
      "turns, last result, recent tool calls) when taskId is given. Results also arrive on their own; use " +
      "this to re-read a result or inspect a subagent that seems stuck.",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String({ description: "Task id or unique prefix (at least 4 characters). Omit for the overview." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const root = rootOf(ctx);
      const own = mine(ctx, await listTree(ctx.cwd, root));
      if (!params.taskId) {
        if (own.length === 0) return text("no subagents launched from this session", { tasks: [] });
        return text(own.map(describe).join("\n"), { tasks: own.map((t) => ({ id: t.id, status: t.status, turns: t.turns })) });
      }
      let t: TaskRecord;
      try {
        t = resolveTaskId(own, params.taskId);
      } catch (err) {
        return fail((err as Error).message);
      }
      const result = await readResult(ctx.cwd, root, t.id, CHECK_CAP);
      const tail = await toolCallTail(t.sessionFile, 10);
      const lines = [
        describe(t),
        "pane " + (t.paneId ?? "?") + " in tmux session " + sessionName(root) + (t.lastStopReason ? ", last stop reason " + t.lastStopReason : ""),
        "",
        "## Last result", result ?? "(none yet)",
      ];
      if (tail.length) lines.push("", "## Recent tool calls", ...tail);
      return text(lines.join("\n"), { taskId: t.id, status: t.status, turns: t.turns, model: t.model, paneId: t.paneId });
    },
  });

  pi.registerTool({
    name: "subagent_wait",
    label: "Wait for subagents",
    description:
      "Block until one of your open subagents finishes a turn or exits, then return its result (instead of it " +
      "arriving as a subagent-result message). Use only when you cannot continue without the result; otherwise " +
      "keep working or end your turn. Returns every result that is ready at that moment.",
    parameters: Type.Object({
      taskIds: Type.Optional(Type.Array(Type.String(), { description: "Task ids or unique prefixes to wait for. Omit to wait for any open subagent." })),
      timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: WAIT_MAX_S, description: "Give up after this long (default " + WAIT_DEFAULT_S + ")." })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const root = rootOf(ctx);
      const open = await openTasks(ctx);
      let targets: TaskRecord[];
      try {
        targets = params.taskIds?.length ? params.taskIds.map((ref) => resolveTaskId(open, ref)) : open;
      } catch (err) {
        return fail((err as Error).message + " (only open subagents can be waited for)");
      }
      if (targets.length === 0) {
        return text("no open subagents to wait for; a subagent that already finished or exited was reported as a subagent-result message", { ready: [] });
      }
      const ids = [...new Set(targets.map((t) => t.id))];
      for (const id of ids) waited.set(id, (waited.get(id) ?? 0) + 1);
      const deadline = Date.now() + (params.timeoutSeconds ?? WAIT_DEFAULT_S) * 1000;
      try {
        while (!signal?.aborted && Date.now() < deadline) {
          const panes = await listPanes(exec, sessionName(root));
          const ready: Ready[] = [];
          let stillOpen = 0;
          for (const id of ids) {
            const t = await readTask(ctx.cwd, root, id);
            if (!t || isTerminal(t.status)) continue;
            stillOpen++;
            const r = await takeReady(ctx.cwd, root, t, panes);
            if (r) ready.push(r);
          }
          if (ready.length === 0 && stillOpen === 0) return text("every subagent waited for was closed", { ready: [] });
          if (ready.length > 0) {
            const parts = await Promise.all(ready.map((r) => formatReady(ctx.cwd, r)));
            return text(parts.join("\n\n---\n\n"), { ready: ready.map((r) => r.task.id) });
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
        const now = (await Promise.all(ids.map((id) => readTask(ctx.cwd, root, id)))).filter((t): t is TaskRecord => !!t);
        return text((signal?.aborted ? "wait cancelled" : "timed out") + "; still running:\n" + now.map(describe).join("\n"),
          { ready: [], timedOut: !signal?.aborted });
      } finally {
        for (const id of ids) {
          const n = (waited.get(id) ?? 1) - 1;
          if (n > 0) waited.set(id, n);
          else waited.delete(id);
        }
        startPoller(ctx);
      }
    },
  });

  pi.registerTool({
    name: "subagent_send",
    label: "Message subagent",
    description:
      "Send a follow-up message to one of your open subagents (a question, a correction, more work). Its next " +
      "result arrives as a subagent-result message like the first one.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task id or unique prefix." }),
      message: Type.String({ minLength: 1, description: "The message, as a user would type it to that subagent." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const root = rootOf(ctx);
      let t: TaskRecord;
      try {
        t = resolveTaskId(mine(ctx, await listTree(ctx.cwd, root)), params.taskId);
      } catch (err) {
        return fail((err as Error).message);
      }
      if (isTerminal(t.status)) return fail("subagent " + shortId(t.id) + " is " + t.status + "; launch a new one instead");
      await appendInbox(ctx.cwd, root, t.id, params.message);
      startPoller(ctx);
      return text("queued for " + shortId(t.id) + "; its reply will arrive as a subagent-result message", { taskId: t.id });
    },
  });

  pi.registerTool({
    name: "subagent_close",
    label: "Close subagent",
    description: "Close one of your subagents (and any subagents it launched): ends its pi process and tmux pane.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task id or unique prefix." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const root = rootOf(ctx);
      const tree = await listTree(ctx.cwd, root);
      let t: TaskRecord;
      try {
        t = resolveTaskId(mine(ctx, tree), params.taskId);
      } catch (err) {
        return fail((err as Error).message);
      }
      if (t.status === "closed") return text(shortId(t.id) + " was already closed", { taskId: t.id });
      try {
        const closed = await closeTask(ctx, t, tree);
        return text("closed " + closed.join(", "), { taskId: t.id, closed });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  });

  // ---- /subagents [--all] ----
  pi.registerCommand("subagents", {
    description: "List this session's subagent tree (--all: every root recorded for this directory)",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const roots = /(^|\s)--all(\s|$)/.test(args) ? await listRoots(ctx.cwd) : [rootOf(ctx)];
      const lines: string[] = [];
      for (const root of roots) {
        const tree = await listTree(ctx.cwd, root);
        if (roots.length > 1) lines.push("root " + shortId(root) + " (" + tree.length + " tasks)");
        const render = (parent: string, depth: number) => {
          for (const t of tree.filter((x) => x.parentSessionId === parent)) {
            lines.push("  ".repeat(depth + (roots.length > 1 ? 1 : 0)) + describe(t));
            render(t.id, depth + 1);
          }
        };
        render(root, 0);
        if (tree.length === 0 && roots.length === 1) lines.push("no subagents in this session");
      }
      if (roots.length === 0) lines.push("no subagent history for " + ctx.cwd);
      const name = sessionName(rootOf(ctx));
      lines.push("", "panes live in tmux session " + name + " (tmux attach -t " + name + ")");
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ---- shutdown: nobody is left to collect orphaned subagents ----
  pi.on("session_shutdown", async (_event, ctx) => {
    stopPoller();
    const root = rootOf(ctx);
    const tree = await listTree(ctx.cwd, root);
    for (const t of mine(ctx, tree)) {
      if (t.status === "closed") continue;
      try {
        await closeTask(ctx, t, tree);
      } catch {
        // best effort; the pane may already be gone
      }
    }
    if (!envRoot) await killSessionIfEmpty(exec, sessionName(root)).catch(() => undefined);
  });
}
