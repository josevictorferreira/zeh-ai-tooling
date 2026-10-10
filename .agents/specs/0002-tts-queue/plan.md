# 0002 — One voice at a time: a cross-harness TTS playback queue

## Problem

Two independent programs speak replies aloud: the pi `tts` extension
(`plugins/pi/tts/index.ts`) and the Claude Code `voice` plugin
(`plugins/claude-code/voice/scripts/speak.mjs`). Each spawns its own audio
player (mpv / ffplay / pw-play) the moment its reply settles. With several pi
sessions, several Claude sessions, or a mix of both open, two replies that
settle close together are spoken over each other.

Today's state, per harness:

| | pi `tts` | Claude `voice` |
| --- | --- | --- |
| Player spawned from | the pi process itself, awaited | a detached `sh -c "player chime; player file"` |
| "Supersede" scope | this pi process only (`current` module state) | **every Claude session of the user**: one global `play.pid` in `$TMPDIR/claude-voice-<uid>` — session B's auto-speak kills session A's audio |
| Cross-harness awareness | none | none |
| macOS player | none of mpv / ffplay / pw-play is on a stock Mac | same |

## Goal

- Across all pi and Claude Code sessions of one user, at most one TTS playback
  runs at a time. Others wait their turn, first come first served.
- Inside one session the current behaviour stays: a new reply replaces that
  session's own pending or playing item; `/speak` again stops that session's
  own item and nothing else.
- Linux and macOS, with no daemon, no new runtime dependency, no `npm install`.

## Non-goals

- A shared audio daemon or an `mpv --input-ipc-server` singleton. More
  lifecycle to manage (launchd / systemd user units, socket paths) for the same
  result.
- Queueing across users, or across machines.
- A "give up waiting after N minutes" timeout. A stuck player is stopped with
  `/speak`, and a dead holder is pruned automatically (below).

## Design: a ticket directory

A tiny bakery-style lock on the filesystem. Both plugins implement the same
protocol; the protocol is the contract, the code is duplicated on purpose
(the two plugins are deliberately self-contained ports of each other — see
`velox.mjs` vs the inline Velox code in the pi extension).

### Queue directory

`TTS_QUEUE_DIR` if set, else:

- Linux: `$XDG_RUNTIME_DIR/tts-queue` when `XDG_RUNTIME_DIR` is set (per-user
  tmpfs, cleared at logout), else `<os.tmpdir()>/tts-queue-<uid>`.
- macOS: `<os.tmpdir()>/tts-queue-<uid>` (`/var/folders/.../T/`, already per
  user).

Created with `mkdir -p` on first use. Both plugins must compute this
identically; it is the only thing that makes them see each other.

### Ticket

One empty file per playback request, created with `O_EXCL` (`wx`), which is
atomic on ext4, tmpfs and APFS:

```
<ms-since-epoch, 13 digits>-<holder pid>-<session tag>
```

- Ordering is lexical on the filename: timestamp, then pid as a deterministic
  tie-break. No file contents, so there is no partial-read race.
- `holder pid` is the process that will spawn the player and that must stay
  alive for the whole playback (pi: the pi process; Claude: the detached play
  worker, see below).
- `session tag` identifies the session for the "replace my own" and "stop my
  own" rules. pi: `pi-<pid>`. Claude: `cc-<transcript basename>` (the
  session id; `hook.transcript_path` in the Stop hook, `currentTranscript()` in
  `/speak`, so both paths agree). Sanitised to `[A-Za-z0-9_-]`.

### Enqueue and wait

1. **Replace own:** delete any ticket carrying my session tag. If its pid is
   not me, SIGTERM it (the Claude worker case). This keeps today's "a new reply
   cuts off the previous one" inside a session, and only inside a session.
2. Create my ticket.
3. Poll every 200 ms: `readdir`, sort. For every ticket ahead of mine, check
   `process.kill(pid, 0)`; `ESRCH` means the holder died without cleaning up,
   so unlink it (`EPERM` means alive). When mine is first, proceed.
4. Play the files **in order under the one ticket**. The chime and the summary
   are one playback, so nobody can slip in between them.
5. Unlink my ticket in `finally`, and on SIGTERM / abort (kill the player
   first).

`firstInLine(names, mine, isAlive) -> { ready, stale[] }` is a pure function so
it can be unit-tested without touching the disk.

Why polling and not `fs.watch`: a 200 ms readdir of a directory with a handful
of entries costs nothing, and `fs.watch` semantics differ between inotify and
FSEvents. Why not `flock(1)`: not on macOS. Why not a lock on a single file:
no FIFO order, and starvation under polling.

### macOS player

Add `afplay` (ships with macOS) to the candidate list in both plugins, after
`ffplay` and before `pw-play`. `TTS_PLAYER` still overrides.

## Changes per plugin

### pi — `plugins/pi/tts/`

- New `queue.ts`: `queueDir()`, `firstInLine()`, `acquire(sessionTag, signal)`
  returning a `release()`; abort while waiting removes the ticket and resolves.
- `index.ts`:
  - `play(files: string[], signal)` instead of `play(file, signal)`: acquire,
    then spawn the player once per file sequentially, then release.
  - `autoSpeak` passes `[alertFile, file]` to one `play` call instead of two.
    Side effect: the chime now plays right before the speech (after
    summarising), as the Claude plugin already did, instead of the moment the
    agent settles.
  - Status bar shows `queued…` while waiting (`ctx.ui.setStatus("tts", …)`),
    then the existing wave.
  - `session_shutdown` keeps calling `stopCurrent()`, which now also releases.
- README: queue section, `TTS_QUEUE_DIR`, `afplay`.
- `package.json`: add `"test": "bun test"`; `tts/queue.test.ts` covers
  `firstInLine` (ahead-alive → wait, ahead-dead → stale + ready, tie-break on
  pid).

### Claude Code — `plugins/claude-code/voice/`

- New `scripts/play.mjs`, the detached worker:
  `play.mjs --session <tag> <file>...` acquires, plays in order, releases;
  `play.mjs --stop --session <tag>` SIGTERMs the worker holding that session's
  ticket (returns whether one was running). Handles SIGTERM: kill the player,
  unlink the ticket, exit.
- `scripts/queue.mjs`: same `queueDir` / `firstInLine` / `acquire` as the pi
  module, in plain ESM.
- `scripts/speak.mjs`:
  - `playDetached(files)` spawns `play.mjs` detached with the session tag;
    the hook / command still returns at once.
  - `stopPlayback()` becomes `play.mjs --stop`. `PID_FILE` goes away: the queue
    directory is the only playback state, and a stop only touches the caller's
    own session.
  - `--auto` no longer calls the global stop; the replace-own step inside
    enqueue does it, scoped to the session.
  - `--cleanup` (SessionEnd) stops own session, then removes cached wavs as
    before.
- `hooks.json`: unchanged (Stop still spawns the detached `--auto` copy, which
  now spawns the worker).
- `velox.mjs` `PLAYERS`: add `afplay`.
- `plugin.json` version `0.1.1` → `0.2.0`; README: queue section, env var,
  `afplay`, and drop the sentence "a new reply cuts off anything still playing"
  in favour of the scoped rule.
- `scripts/queue.test.mjs` with `node --test`, same cases as the pi test.

### Nix

No change. The pi harness copies every `plugins/pi/<name>/` directory whole,
and the Claude harness registers `plugins/claude-code` in place, so the new
files ship on the next rebuild. `tests/render/` snapshots are untouched.

## Steps

1. Pure core + unit tests in both plugins (`queue.ts`, `queue.mjs`)
   → verify: `bun test` in `plugins/pi`, `node --test` in
   `plugins/claude-code/voice/scripts`; `bun run check` passes.
2. Claude worker `play.mjs` and `speak.mjs` rewiring
   → verify: with `TTS_PLAYER` pointing at a fake player script that logs
   `start <pid> <file>` / `end <pid>` with timestamps and sleeps 2 s, launch
   two `play.mjs --session a x.wav` / `--session b y.wav` at once: the log has
   no overlapping start/end intervals, and the second starts after the first
   ends. `--stop --session a` during playback ends only `a`.
3. pi `play` rewiring
   → verify: same fake player, one pi session with `TTS_AUTO_SPEAK=1` and one
   `play.mjs` worker started from a shell: pi's status shows `queued…` until
   the worker ends, then speaks. `/speak` while queued cancels without playing.
4. Cross-harness check
   → verify: one pi session and one Claude session, both auto-speak, fed two
   prompts within a second of each other: audio is sequential; each session's
   second prompt replaces only its own pending item.
5. Stale-holder check
   → verify: `kill -9` a worker mid-playback; the next request starts within
   one poll interval, and the dead ticket is gone.
6. Docs, version bump, `git add -A && nix flake check`.

## Status

Implemented 2026-10-10. Steps 1, 2 and 5 verified as written with a fake
player; steps 3 and 4 verified at the protocol level (a `queue.ts` stand-in
waiting behind a Claude worker, and aborting while queued) rather than inside
a live pi or Claude session. `bun run check` reports one pre-existing error in
`skill-state/tool-registry.ts` unrelated to this change.

## Alternative considered

A single `packages/tts-play` CLI (Nix package on PATH) that both plugins shell
out to. One implementation instead of two, and both plugins get simpler. Not
chosen now because the Claude plugin convention is "no dependencies beyond
Node", the pi extension directory is self-contained by design, and a plugin
run outside the Nix-managed machine would silently fall back to overlapping
audio. If a third harness ever needs to speak, extract the protocol into that
package then.
