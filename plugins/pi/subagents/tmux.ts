import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";

// Thin tmux adapter. `exec` is pi.exec injected by the caller so this module can
// be driven from a scratch script against a private tmux server (`tmux -L`).
// Every call is bounded by a 5 s timeout; failures surface as thrown Errors
// carrying tmux's stderr so tool results can show them.

export type Exec = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

export const WINDOW_NAME = "subagents";
const TIMEOUT = 5000;

// tmux has no nested sessions. The session holding a root's panes is tagged
// with this user option and found by it, so its name is free to describe where
// it came from: "<launcher's tmux session>/pi-<pi session name or cwd>".
const ROOT_OPTION = "@pi_root";

/** POSIX single-quote quoting; valid in sh, bash, zsh and fish. */
export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

async function tmux(exec: Exec, args: string[]): Promise<string> {
  const result = await exec("tmux", args, { timeout: TIMEOUT });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || (result.killed ? "timed out" : "exit " + result.code);
    throw new Error("tmux " + args[0] + " failed: " + detail);
  }
  return result.stdout.trim();
}

export async function hasSession(exec: Exec, name: string): Promise<boolean> {
  const result = await exec("tmux", ["has-session", "-t", "=" + name], { timeout: TIMEOUT });
  return result.code === 0;
}

export interface SpawnOptions {
  /** Root session id; selects (or tags) the tmux session. */
  root: string;
  /** Name for the session when this root has none yet. */
  name: string;
  cwd: string;
  env: Record<string, string>;
  /** Shell command line, already quoted (see shellQuote). */
  command: string;
}

/** The tmux session holding this root's panes, found by its tag. */
export async function findSession(exec: Exec, root: string): Promise<string | undefined> {
  const result = await exec("tmux", ["list-sessions", "-F", "#{" + ROOT_OPTION + "}\t#{session_name}"], { timeout: TIMEOUT });
  if (result.code !== 0) return undefined;
  for (const line of result.stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab > 0 && line.slice(0, tab) === root) return line.slice(tab + 1);
  }
  return undefined;
}

/** Session name of a pane (the launcher's own, via $TMUX_PANE); undefined outside tmux. */
export async function paneSession(exec: Exec, paneId: string | undefined): Promise<string | undefined> {
  if (!paneId) return undefined;
  const result = await exec("tmux", ["display-message", "-p", "-t", paneId, "#{session_name}"], { timeout: TIMEOUT });
  return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

/** tmux rejects "." and ":" in session names. */
export function cleanName(name: string): string {
  return name.replace(/[.:]/g, "_").trim();
}

/**
 * Run `command` in a new pane of the root's session, creating and tagging the
 * session when needed (the first subagent is then the first pane, no idle shell
 * is left). A name already taken by another session gets the root id appended.
 */
export async function spawnPane(exec: Exec, options: SpawnOptions): Promise<{ paneId: string; session: string }> {
  const envArgs = Object.entries(options.env).flatMap(([k, v]) => ["-e", k + "=" + v]);
  const common = ["-c", options.cwd, ...envArgs, "-P", "-F", "#{pane_id}"];
  let session = await findSession(exec, options.root);
  let paneId: string;
  if (!session) {
    session = cleanName(options.name);
    if (await hasSession(exec, session)) session += "-" + options.root.slice(0, 8);
    paneId = await tmux(exec, ["new-session", "-d", "-s", session, "-n", WINDOW_NAME, ...common, options.command]);
    await tmux(exec, ["set-option", "-t", paneId, ROOT_OPTION, options.root]);
  } else {
    try {
      paneId = await tmux(exec, ["split-window", "-t", "=" + session + ":" + WINDOW_NAME, ...common, options.command]);
    } catch {
      // the window was closed or renamed: start a fresh one with the same name
      paneId = await tmux(exec, ["new-window", "-t", "=" + session + ":", "-n", WINDOW_NAME, ...common, options.command]);
    }
  }
  await exec("tmux", ["select-layout", "-t", paneId, "tiled"], { timeout: TIMEOUT });
  return { paneId, session };
}

/** Rename the root's session, keeping it unique; returns the name it ends up with. */
export async function renameSession(exec: Exec, root: string, name: string): Promise<string | undefined> {
  const current = await findSession(exec, root);
  if (!current) return undefined;
  let next = cleanName(name);
  if (next === current) return current;
  if (await hasSession(exec, next)) next += "-" + root.slice(0, 8);
  const result = await exec("tmux", ["rename-session", "-t", "=" + current, next], { timeout: TIMEOUT });
  return result.code === 0 ? next : current;
}

/** Ids of every pane alive on the server (pane ids are unique server-wide). */
export async function livePanes(exec: Exec): Promise<Set<string>> {
  const result = await exec("tmux", ["list-panes", "-a", "-F", "#{pane_id}"], { timeout: TIMEOUT });
  if (result.code !== 0) return new Set();
  return new Set(result.stdout.split("\n").map((l) => l.trim()).filter(Boolean));
}

export async function killPane(exec: Exec, paneId: string): Promise<void> {
  const result = await exec("tmux", ["kill-pane", "-t", paneId], { timeout: TIMEOUT });
  // "can't find pane" / "no server running" mean it is already gone, which is what we want
  if (result.code !== 0 && !/can't find|no such|no server running/i.test(result.stderr)) {
    throw new Error("tmux kill-pane failed: " + (result.stderr.trim() || "exit " + result.code));
  }
}

/** Kill the root's session if no pane is left in it. */
export async function killSessionIfEmpty(exec: Exec, root: string): Promise<void> {
  const session = await findSession(exec, root);
  if (!session) return;
  const result = await exec("tmux", ["list-panes", "-s", "-t", "=" + session, "-F", "#{pane_id}"], { timeout: TIMEOUT });
  if (result.code === 0 && result.stdout.trim()) return;
  await exec("tmux", ["kill-session", "-t", "=" + session], { timeout: TIMEOUT });
}

/**
 * The tmux server's global environment, which new panes start from; undefined
 * when no server is running (a new server copies the caller's environment).
 * `-NAME` lines mark variables removed from it.
 */
export async function serverEnvironment(exec: Exec): Promise<Map<string, string | null> | undefined> {
  const result = await exec("tmux", ["show-environment", "-g"], { timeout: TIMEOUT });
  if (result.code !== 0) return undefined;
  const env = new Map<string, string | null>();
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("-")) env.set(line.slice(1).trim(), null);
    else {
      const eq = line.indexOf("=");
      if (eq > 0) env.set(line.slice(0, eq), line.slice(eq + 1));
    }
  }
  return env;
}
