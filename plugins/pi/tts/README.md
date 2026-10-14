# tts

Summarizes the last agent reply and plays it as speech. Pure user-facing
convenience: no tools, nothing enters the LLM conversation.

## Usage

- `/speak` — summarize the last assistant message and speak it. Invoking it
  again while busy stops the current playback.
- `ctrl+alt+s` — same action.
- Auto mode: set `TTS_AUTO_SPEAK=1` to speak automatically every time the agent
  stops (reply finished, question asked, or run aborted). A brief chime alert
  plays right before auto-speaking. A new reply cuts off this session's own
  playback still in progress. `/speak` still works as a manual stop.

## Behavior

1. Reads the latest assistant text from the current session branch.
2. Only that step is summarized into 1–3 spoken sentences via Velox
   `POST /v1/chat/completions`, written in `TTS_LANGUAGE`, so a reply in
   another language is translated before it is spoken. The last few user
   and assistant turns go along as context so references make sense; they
   are not recapped.
3. The summary is prefixed with the session label: the name set with
   `/name`, or the project directory name when the session is unnamed.
4. Speech is synthesized with Velox `POST /v1/audio/speech` (wav), cached
   in a temp file keyed by the message ID, session label and configuration, and played
   locally. Re-running `/speak` on the same message reuses the cached audio
   without making summarization or TTS API calls. Cached files are cleaned up on
   session shutdown or process exit.
5. Playback waits for its turn in a queue shared with every other pi and
   Claude Code session of the user (see below), so two agents never talk over
   each other. The status bar shows `queued…` while waiting.
6. No-op without a UI (print/json modes). Playback is aborted on
   `session_shutdown`.

## Playback queue

The same protocol is implemented by the Claude Code `voice` plugin
(`plugins/claude-code/voice/scripts/queue.mjs`); both must agree on it.

- Directory: `TTS_QUEUE_DIR`, else `$XDG_RUNTIME_DIR/tts-queue` on Linux, else
  `<tmpdir>/tts-queue-<uid>`.
- One empty ticket file per playback, created atomically, named
  `<ms13>-<pid>-<session>`. Lexical order is arrival order; the holder pid
  must stay alive for the whole playback (here: the pi process). The session
  tag is `pi-<pid>`.
- A waiter polls every 200 ms. Tickets ahead of it whose pid is dead are
  pruned, so a crashed holder never blocks the queue.
- Before enqueueing, any ticket of the same session is dropped: a new reply
  replaces this session's pending or playing item and nothing else. Other
  sessions are queued first come, first served.
- The chime and the speech play under one ticket, so nothing slips in between.

## Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `VELOX_API_URL` | `https://velox.josevictor.me` | Velox base URL (shared with web-tools) |
| `VELOX_API_KEY` | — | required bearer token |
| `TTS_MODEL` | `voice` | speech combo/model alias (velox `[combos.voice]`: speechify-tts, then elevenlabs-tts) |
| `TTS_VOICE` | `gwen` | canonical velox combo voice name; velox maps it to a native voice per language (gwen: harper_32 in English, luana in pt-BR). A raw provider id not in the combo table is dropped and falls back to the provider default |
| `TTS_SUMMARY_MODEL` | `deepseek-v4-flash` | chat model alias for the summary |
| `TTS_LANGUAGE` | `pt-BR` | spoken language — the summary is written in it and it is sent to the speech endpoint |
| `TTS_AUTO_SPEAK` | off | `1`/`true` speaks every reply automatically when the agent stops |
| `TTS_PLAYER` | auto-detect | explicit player command, e.g. `mpv --no-video --really-quiet` |
| `TTS_QUEUE_DIR` | see above | directory of the playback queue shared with Claude Code |

## Player detection

`TTS_PLAYER` (split on whitespace) if set; otherwise the first available of
`mpv --no-video --really-quiet`, `ffplay -nodisp -autoexit -loglevel quiet`,
`afplay` (macOS built-in), `pw-play`.

## Tests

`bun run test` runs the queue's pure ordering logic under `node --test`.
