// Cross-process playback queue shared with the Claude Code voice plugin.
//
// One empty ticket file per playback request in a per-user directory, named
// `<ms13>-<pid>-<session>`. Lexical order is arrival order. A ticket whose pid
// is dead is stale and gets pruned by whoever is waiting behind it. The
// protocol is duplicated in plugins/claude-code/voice/scripts/queue.mjs:
// both must agree on the directory and the ticket name.
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const POLL_MS = 200;

export function queueDir(): string {
  if (process.env.TTS_QUEUE_DIR) return process.env.TTS_QUEUE_DIR;
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (process.platform === "linux" && runtime) return join(runtime, "tts-queue");
  return join(tmpdir(), "tts-queue-" + (process.getuid?.() ?? 0));
}

export type Ticket = { name: string; ts: number; pid: number; session: string };

export function ticketName(pid: number, session: string, now = Date.now()): string {
  return String(now).padStart(13, "0") + "-" + pid + "-" + session.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function parseTicket(name: string): Ticket | undefined {
  const m = /^(\d{13})-(\d+)-([A-Za-z0-9_-]+)$/.exec(name);
  if (!m) return undefined;
  return { name, ts: Number(m[1]), pid: Number(m[2]), session: m[3] };
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM"; // alive, owned by someone else
  }
}

export type LineState = "ready" | "wait" | "gone";

/** Pure: where does `mine` stand among `names`? `stale` lists dead tickets ahead of it. */
export function firstInLine(
  names: string[],
  mine: string,
  alive: (pid: number) => boolean = isAlive,
): { state: LineState; stale: string[] } {
  const tickets = names.map(parseTicket).filter((t): t is Ticket => t !== undefined);
  if (!tickets.some((t) => t.name === mine)) return { state: "gone", stale: [] };
  const stale: string[] = [];
  let blocked = false;
  for (const t of tickets.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (t.name >= mine) break;
    if (alive(t.pid)) blocked = true;
    else stale.push(t.name);
  }
  return { state: blocked ? "wait" : "ready", stale };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

// Tickets this process holds, so `exit` can drop them synchronously.
const held = new Set<string>();

export function releaseAllSync(): void {
  for (const path of held) {
    try {
      unlinkSync(path);
    } catch {
      // Already gone.
    }
  }
  held.clear();
}

/**
 * Wait for the turn of `session`. Any earlier ticket of the same session is
 * dropped first (a new reply replaces the previous one). Resolves with a
 * release function; throws "aborted" if the signal fires or the ticket is
 * removed by a newer request of the same session.
 */
export async function acquire(
  session: string,
  signal: AbortSignal,
  onWait?: () => void,
): Promise<() => Promise<void>> {
  const dir = queueDir();
  await mkdir(dir, { recursive: true });

  for (const name of await readdir(dir)) {
    const t = parseTicket(name);
    if (!t || t.session !== session) continue;
    if (t.pid !== process.pid) {
      try {
        process.kill(t.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
    await unlink(join(dir, name)).catch(() => {});
  }

  const mine = ticketName(process.pid, session);
  const path = join(dir, mine);
  await writeFile(path, "", { flag: "wx" });
  held.add(path);
  const release = async () => {
    held.delete(path);
    await unlink(path).catch(() => {});
  };

  let waited = false;
  while (true) {
    if (signal.aborted) {
      await release();
      throw "aborted";
    }
    const { state, stale } = firstInLine(await readdir(dir), mine);
    for (const name of stale) await unlink(join(dir, name)).catch(() => {});
    if (state === "ready") return release;
    if (state === "gone") {
      held.delete(path);
      throw "aborted";
    }
    if (!waited) {
      waited = true;
      onWait?.();
    }
    await sleep(POLL_MS, signal);
  }
}
