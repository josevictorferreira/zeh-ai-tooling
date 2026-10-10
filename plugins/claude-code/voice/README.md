# voice

Speech in and out of Claude Code, through [Velox](https://velox.josevictor.me).
A port of the `tts` and `stt` extensions from
[my-pi-agent-plugins](https://github.com/josevictorferreira/my-pi-agent-plugins),
using the same endpoints and the same models.

- `/speak` — summarize the last agent reply and play it. Run it again to stop.
- `/dictate` — record from the microphone, transcribe, and put the text on your
  clipboard so you can paste, edit and send it yourself.

Nothing either command produces enters the LLM conversation as an instruction.

## /speak

1. Reads the latest assistant text from the current session's transcript.
2. Summarizes it into 2–3 spoken sentences via Velox
   `POST /v1/chat/completions`, written in `TTS_LANGUAGE`, so a reply in another
   language is translated before it is spoken.
3. Synthesizes it with `POST /v1/audio/speech` (wav), caches the file keyed by
   message id + configuration, and plays it detached — the command returns
   immediately while the audio plays.
4. A second `/speak` stops playback. Re-running it on the same message replays
   the cached audio without calling either API again.

**Auto mode:** set `TTS_AUTO_SPEAK=1` and every settled reply is spoken
automatically, preceded by a short rising chime. A new reply cuts off this
session's own playback; other sessions are not touched. `/speak` still works
as a manual stop. When it is off the Stop hook exits immediately and costs
nothing.

### Playback queue

Playback waits for its turn in a queue shared with every other Claude Code and
pi session of the user, so two agents never talk over each other. The same
protocol lives in the pi `tts` extension (`plugins/pi/tts/queue.ts`); both
must agree on it.

- Directory: `TTS_QUEUE_DIR`, else `$XDG_RUNTIME_DIR/tts-queue` on Linux, else
  `<tmpdir>/tts-queue-<uid>`.
- One empty ticket file per playback, created atomically, named
  `<ms13>-<pid>-<session>`. Lexical order is arrival order; the holder pid
  must stay alive for the whole playback. Here that is a detached
  `scripts/play.mjs` worker, one per request, so the hook or command returns
  at once. The session tag is `cc-<transcript file name>`, which is the
  session id.
- A waiter polls every 200 ms. Tickets ahead of it whose pid is dead are
  pruned, so a crashed holder never blocks the queue.
- Before enqueueing, any ticket of the same session is dropped and its worker
  terminated: a new reply replaces this session's pending or playing item and
  nothing else. `/speak` as a stop does the same. Other sessions are queued
  first come, first served.
- The chime and the speech play under one ticket, so nothing slips in between.

## /dictate

Records, then transcribes with `POST /v1/audio/transcriptions` and copies the
result to the clipboard.

**Recording stops on its own** once you have spoken and then stay quiet for
`STT_SILENCE_MS` (default 2 s). If you say nothing at all it gives up after
`STT_LEADIN_SECONDS` (10 s); a long dictation is capped at `STT_MAX_SECONDS`
(120 s). There is no second keypress to stop early — Claude Code runs the
command as one blocking call — so the pause is the stop signal. `esc` aborts.

Audio is captured as raw s16le mono 16 kHz PCM, wrapped in a WAV header and sent
as one clip. Clips with under 0.5 s of speech are dropped rather than uploaded:
Whisper-class models hallucinate on silence.

## Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `VELOX_API_URL` | `https://velox.josevictor.me` | Velox base URL |
| `VELOX_API_KEY` | — | **required** bearer token |
| `TTS_MODEL` | `voice` | speech combo (velox `[combos.voice]`: speechify-tts, then elevenlabs-tts) |
| `TTS_VOICE` | `stone` | velox combo voice name, resolved per target (a raw provider id like `geffen_32` is not in the combo table and gets dropped) |
| `TTS_SUMMARY_MODEL` | `deepseek-v4-flash` | chat model for the summary |
| `TTS_LANGUAGE` | `pt-BR` | spoken language — the summary is written in it and it is sent to the speech endpoint |
| `TTS_AUTO_SPEAK` | off | `1`/`true` speaks every reply automatically |
| `TTS_PLAYER` | auto-detect | explicit player command, e.g. `mpv --no-video --really-quiet` |
| `TTS_QUEUE_DIR` | see above | directory of the playback queue shared with pi |
| `STT_MODEL` | `stt-1` | transcription combo (elevenlabs-stt) |
| `STT_LANGUAGE` | unset (auto-detect) | ISO-639-1 code sent as `language` |
| `STT_RECORDER` | auto-detect | recorder command; must write raw PCM to stdout |
| `STT_SILENCE_MS` | `2000` | trailing silence that ends a recording |
| `STT_LEADIN_SECONDS` | `10` | give up if no speech at all by then |
| `STT_MAX_SECONDS` | `120` | hard cap |
| `STT_CLIPBOARD` | auto-detect | explicit clipboard command |

> The pi extension still defaults `STT_MODEL` to `scribe`, which Velox no longer
> serves — that alias now returns `404 not a configured model or combo`. This
> plugin defaults to `stt-1` instead.

## External commands

| Role | Tried in order |
| --- | --- |
| Player | `mpv --no-video --really-quiet`, `ffplay -nodisp -autoexit -loglevel quiet`, `afplay` (macOS built-in), `pw-play` |
| Recorder | `pw-record --raw --rate 16000 --channels 1 --format s16 -`, `ffmpeg -f pulse -i default -ac 1 -ar 16000 -f s16le -` |
| Clipboard | `wl-copy`, `xclip -selection clipboard`, `xsel --clipboard --input`, `pbcopy` |

The recorder must emit **raw s16le mono 16 kHz PCM on stdout** — no container,
no output file. Node is the only runtime dependency, and Claude Code ships it.

## Tests

```sh
node --test voice/scripts/queue.test.mjs
```

## Differences from the pi extensions

Claude Code's plugin surface is narrower than pi's `ExtensionAPI`, so three
things could not be carried over:

| pi | here |
| --- | --- |
| `ui.setEditorText` — phrases appended to the prompt as you talk | no editor API exists; the transcript goes to the clipboard instead |
| `ctrl+alt+s` / `ctrl+alt+d` | `keybindings.json` only maps a fixed list of built-in actions, so custom commands cannot be bound |
| live `● ▁▂▄▇█` meter and animated "Speaking" status | no status/widget API; command output is captured, not streamed to the terminal |

Because dictation is one blocking call rather than a toggle, phrase-by-phrase
streaming transcription was dropped too: one recording, one upload.
