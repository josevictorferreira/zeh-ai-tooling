#!/usr/bin/env node
// Detached playback worker: wait for this session's turn in the shared queue,
// then play the files in order. speak.mjs spawns one per request; a SIGTERM
// (from /speak or a newer request of the same session) stops the player and
// drops the ticket.
//
//   play.mjs --session <tag> <file>...
import { spawn } from "node:child_process";
import { acquire } from "./queue.mjs";
import { PLAYERS, findCommand } from "./velox.mjs";

const argv = process.argv.slice(2);
const at = argv.indexOf("--session");
const session = at >= 0 ? argv[at + 1] : undefined;
const files = argv.filter((_, i) => i !== at && i !== at + 1);
if (!session || files.length === 0) {
  console.error("usage: play.mjs --session <tag> <file>...");
  process.exit(2);
}

let child;
let release = () => {};
process.on("SIGTERM", () => {
  child?.kill("SIGTERM");
  release();
  process.exit(0);
});

try {
  const { cmd, args } = await findCommand(process.env.TTS_PLAYER, PLAYERS, "TTS_PLAYER");
  release = await acquire(session);
  for (const file of files) {
    await new Promise((resolve, reject) => {
      child = spawn(cmd, [...args, file], { stdio: "ignore" });
      child.on("error", reject);
      child.on("close", resolve);
    });
  }
} catch {
  // Superseded, or the player failed: nothing is watching a detached worker.
} finally {
  release();
}
