// Cross-process playback queue shared with the pi tts extension.
//
// One empty ticket file per playback request in a per-user directory, named
// `<ms13>-<pid>-<session>`. Lexical order is arrival order. A ticket whose pid
// is dead is stale and gets pruned by whoever is waiting behind it. The
// protocol is duplicated in plugins/pi/tts/queue.ts: both must agree on the
// directory and the ticket name.
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const POLL_MS = 200;

export function queueDir() {
  if (process.env.TTS_QUEUE_DIR) return process.env.TTS_QUEUE_DIR;
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (process.platform === "linux" && runtime) return join(runtime, "tts-queue");
  return join(tmpdir(), "tts-queue-" + (process.getuid?.() ?? 0));
}

export function ticketName(pid, session, now = Date.now()) {
  return String(now).padStart(13, "0") + "-" + pid + "-" + session.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function parseTicket(name) {
  const m = /^(\d{13})-(\d+)-([A-Za-z0-9_-]+)$/.exec(name);
  if (!m) return undefined;
  return { name, ts: Number(m[1]), pid: Number(m[2]), session: m[3] };
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM"; // alive, owned by someone else
  }
}

/** Pure: where does `mine` stand among `names`? `stale` lists dead tickets ahead of it. */
export function firstInLine(names, mine, alive = isAlive) {
  const tickets = names.map(parseTicket).filter(Boolean);
  if (!tickets.some((t) => t.name === mine)) return { state: "gone", stale: [] };
  const stale = [];
  let blocked = false;
  for (const t of tickets.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (t.name >= mine) break;
    if (alive(t.pid)) blocked = true;
    else stale.push(t.name);
  }
  return { state: blocked ? "wait" : "ready", stale };
}

/**
 * Drop every ticket of `session`, terminating the worker that holds it.
 * Returns whether any was found.
 */
export function stopSession(session) {
  const dir = queueDir();
  mkdirSync(dir, { recursive: true });
  let found = false;
  for (const name of readdirSync(dir)) {
    const t = parseTicket(name);
    if (!t || t.session !== session) continue;
    found = true;
    if (t.pid !== process.pid) {
      try {
        process.kill(t.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
    try {
      unlinkSync(join(dir, name));
    } catch {
      // Already gone.
    }
  }
  return found;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for the turn of `session`. Any earlier ticket of the same session is
 * dropped first (a new reply replaces the previous one). Resolves with a
 * synchronous release function, or throws "superseded" if a newer request of
 * the same session removed the ticket while it waited.
 */
export async function acquire(session, onWait) {
  const dir = queueDir();
  stopSession(session);

  const mine = ticketName(process.pid, session);
  const path = join(dir, mine);
  writeFileSync(path, "", { flag: "wx" });
  const release = () => {
    try {
      unlinkSync(path);
    } catch {
      // Already gone.
    }
  };

  let waited = false;
  while (true) {
    const { state, stale } = firstInLine(readdirSync(dir), mine);
    for (const name of stale) {
      try {
        unlinkSync(join(dir, name));
      } catch {
        // Already gone.
      }
    }
    if (state === "ready") return release;
    if (state === "gone") throw "superseded";
    if (!waited) {
      waited = true;
      onWait?.();
    }
    await sleep(POLL_MS);
  }
}
