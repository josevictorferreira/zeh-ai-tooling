import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { access, unlink, writeFile } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { acquire, releaseAllSync } from "./queue";

const DEFAULT_API_URL = "https://velox.josevictor.me";

const TTS_MODEL = () => process.env.TTS_MODEL || "voice";
const TTS_VOICE = () => process.env.TTS_VOICE || "gwen";
const SUMMARY_MODEL = () => process.env.TTS_SUMMARY_MODEL || "deepseek-v4-flash";
const TTS_LANGUAGE = () => process.env.TTS_LANGUAGE || "pt-BR";
const AUTO_SPEAK = () => /^(1|true|yes|on)$/i.test(process.env.TTS_AUTO_SPEAK || "");

// /v1/audio/speech rejects input above 4096 chars; stay under it.
const MAX_SPEECH_CHARS = 4000;

// Earlier turns sent along so the summary can resolve references.
const CONTEXT_MESSAGES = 4;
const CONTEXT_CHARS = 6000;

const SUMMARY_PROMPT =
  "You turn a coding assistant's latest message into a short spoken update " +
  "for text-to-speech. Say only what the latest message tells the user right " +
  "now: what was just done or found, and any question or decision left for " +
  "them. Use the earlier conversation only to understand what the latest " +
  "message refers to; never recap it. If the latest message recaps the whole " +
  "session, keep only its outcome and what is new. 1-3 short, casual spoken " +
  "sentences, like telling a colleague. No markdown, no code, no lists, no file paths.";

function apiUrl(): string {
  return (process.env.VELOX_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

/** POST a JSON body to a Velox endpoint. Returns the Response or throws a string. */
async function veloxFetch(
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  const key = process.env.VELOX_API_KEY;
  if (!key) throw "VELOX_API_KEY is not set";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + key,
  };

  let response: Response;
  try {
    response = await fetch(apiUrl() + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw "aborted";
    throw "request failed: " + String(err);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    // Errors come back as an OpenAI-shaped { error: { message } } envelope.
    let message = errText;
    try {
      message = JSON.parse(errText)?.error?.message || errText;
    } catch {
      // Not JSON — relay the raw body.
    }
    throw "HTTP " + response.status + ": " + message;
  }
  return response;
}

/** Text blocks of a message, joined. Handles string and block-array content. */
function messageText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block: any) => block?.type === "text" && typeof block.text === "string")
    .map((block: any) => block.text)
    .join("\n")
    .trim();
}

type LastMessage = { id: string; text: string; context: string };

/**
 * Latest assistant message on the current branch, with the few user and
 * assistant turns before it as context, or undefined.
 */
function lastAssistantMessage(ctx: ExtensionContext): LastMessage | undefined {
  const branch = ctx.sessionManager.getBranch();
  let msg: { id: string; text: string } | undefined;
  const context: string[] = [];
  for (let i = branch.length - 1; i >= 0 && context.length < CONTEXT_MESSAGES; i--) {
    const entry: any = branch[i];
    const role = entry?.type === "message" ? entry.message?.role : undefined;
    if (role !== "assistant" && role !== "user") continue;
    const text = messageText(entry.message);
    if (!text) continue;
    if (!msg) {
      if (role === "assistant") msg = { id: entry.id ?? text, text };
    } else {
      context.unshift((role === "user" ? "User: " : "Assistant: ") + text);
    }
  }
  return msg && { ...msg, context: context.join("\n\n").slice(-CONTEXT_CHARS) };
}

/** Spoken session label: the /name session name, else the project directory. */
function sessionLabel(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionName()?.trim() || basename(ctx.cwd);
}

function summaryInput({ text, context }: LastMessage): string {
  const latest = "Latest message (speak this):\n" + text.slice(0, 20000);
  return context ? "Earlier conversation (context only):\n" + context + "\n\n" + latest : latest;
}

/** Ask Velox for a short spoken-style summary of the latest step. */
async function summarize(msg: LastMessage, signal: AbortSignal): Promise<string> {
  const response = await veloxFetch(
    "/v1/chat/completions",
    {
      model: SUMMARY_MODEL(),
      messages: [
        {
          role: "system",
          content: SUMMARY_PROMPT + " Write the summary in " + TTS_LANGUAGE() + ".",
        },
        { role: "user", content: summaryInput(msg) },
      ],
      max_tokens: 200,
    },
    signal,
  );
  const data: any = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw "summarizer returned no text";
  return content.trim().slice(0, MAX_SPEECH_CHARS);
}

/** Convert text to wav audio bytes via Velox. */
async function synthesize(input: string, signal: AbortSignal): Promise<Buffer> {
  const response = await veloxFetch(
    "/v1/audio/speech",
    {
      model: TTS_MODEL(),
      input,
      voice: TTS_VOICE(),
      response_format: "wav",
      language: TTS_LANGUAGE(),
    },
    signal,
  );
  return Buffer.from(await response.arrayBuffer());
}

async function canExecute(bin: string): Promise<boolean> {
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    try {
      await access(join(dir, bin), 1); // X_OK
      return true;
    } catch {
      // Not in this dir — keep looking.
    }
  }
  return false;
}

const PLAYER_ARGS: Record<string, string[]> = {
  mpv: ["--no-video", "--really-quiet"],
  ffplay: ["-nodisp", "-autoexit", "-loglevel", "quiet"],
  afplay: [], // macOS built-in
  "pw-play": [],
};

/** Resolve the player command: TTS_PLAYER override, else first available. */
async function findPlayer(): Promise<{ cmd: string; args: string[] }> {
  const override = process.env.TTS_PLAYER;
  if (override) {
    const parts = override.split(/\s+/).filter(Boolean);
    if (parts.length === 0) throw "TTS_PLAYER is set but empty";
    return { cmd: parts[0], args: parts.slice(1) };
  }
  for (const bin of Object.keys(PLAYER_ARGS)) {
    if (await canExecute(bin)) return { cmd: bin, args: PLAYER_ARGS[bin] };
  }
  throw "no audio player found (tried " + Object.keys(PLAYER_ARGS).join(", ") + ")";
}

/** Play an audio file; resolves on close; killed on abort. */
function play(file: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve();
    findPlayer()
      .then(({ cmd, args }) => {
        // A listener added to an already-aborted signal never fires, so the
        // player would keep going unkillable. Check before spawning.
        if (signal.aborted) return resolve();
        const child = spawn(cmd, args.concat(file), { stdio: "ignore" });
        const onAbort = () => child.kill("SIGTERM");
        signal.addEventListener("abort", onAbort, { once: true });
        child.on("error", (err) => {
          signal.removeEventListener("abort", onAbort);
          reject("player " + cmd + " failed to start: " + String(err));
        });
        child.on("close", () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        });
      })
      .catch(reject);
  });
}

// --- Session-scoped run state -----------------------------------------------

let current: { controller: AbortController; file: string } | undefined;
let runSeq = 0;

const MAX_CACHE_ENTRIES = 50;
const audioCache = new Map<string, string>();
const sessionFiles = new Set<string>();

function stopCurrent(): void {
  if (!current) return;
  current.controller.abort();
}

async function getCachedAudio(key: string): Promise<string | undefined> {
  const file = audioCache.get(key);
  if (!file) return undefined;
  try {
    await access(file);
    // Refresh LRU order
    audioCache.delete(key);
    audioCache.set(key, file);
    return file;
  } catch {
    audioCache.delete(key);
    sessionFiles.delete(file);
    return undefined;
  }
}

function cacheAudio(key: string, file: string): void {
  const oldFile = audioCache.get(key);
  if (oldFile && oldFile !== file) {
    sessionFiles.delete(oldFile);
    unlink(oldFile).catch(() => {});
  }

  if (audioCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = audioCache.keys().next().value;
    if (oldestKey !== undefined) {
      const oldestFile = audioCache.get(oldestKey);
      audioCache.delete(oldestKey);
      if (oldestFile) {
        sessionFiles.delete(oldestFile);
        unlink(oldestFile).catch(() => {});
      }
    }
  }

  audioCache.set(key, file);
  sessionFiles.add(file);
}

function cleanupFiles(): void {
  for (const file of sessionFiles) {
    try {
      unlinkSync(file);
    } catch {
      // Ignore
    }
  }
  sessionFiles.clear();
  audioCache.clear();
}

let alertSoundFile: string | undefined;

/** Generates a small pleasant 120ms rising chime (700Hz -> 1050Hz) in PCM WAV format. */
function generateAlertWav(): Buffer {
  const sampleRate = 44100;
  const duration = 0.12;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = Buffer.alloc(44 + numSamples * 2);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = Math.sin((Math.PI * i) / numSamples);
    const freq = 700 + 350 * (i / numSamples);
    const sample = Math.sin(2 * Math.PI * freq * t) * env * 0.25 * 32767;
    buffer.writeInt16LE(Math.floor(sample), 44 + i * 2);
  }
  return buffer;
}

async function getAlertSoundFile(): Promise<string> {
  if (alertSoundFile) return alertSoundFile;
  const path = join(tmpdir(), "pi-tts-alert-" + process.pid + ".wav");
  await writeFile(path, generateAlertWav());
  sessionFiles.add(path);
  alertSoundFile = path;
  return path;
}

// --- Speaking indicator -----------------------------------------------------

const WAVE_LEVELS = "▁▂▃▄▅▆▇";
const WAVE_BARS = 5;
const WAVE_INTERVAL_MS = 120;

/** One frame of a travelling sine wave, drawn as block bars. */
function waveFrame(tick: number): string {
  let frame = "";
  for (let i = 0; i < WAVE_BARS; i++) {
    const phase = (tick - i) * 0.7;
    const level = Math.round(((Math.sin(phase) + 1) / 2) * (WAVE_LEVELS.length - 1));
    frame += WAVE_LEVELS[level];
  }
  return frame;
}

/** Animate "<wave> Speaking" in the status bar; returns a stop function. */
function startWave(ctx: ExtensionContext): () => void {
  let tick = 0;
  const paint = () => ctx.ui.setStatus("tts", waveFrame(tick++) + " Speaking");
  paint();
  const timer = setInterval(paint, WAVE_INTERVAL_MS);
  return () => clearInterval(timer);
}

/** Manual trigger: speak the last reply, or stop if already speaking. */
async function speakLastMessage(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return; // print/json modes: no-op

  // A second invocation stops whatever is playing instead of queueing.
  if (current) {
    stopCurrent();
    ctx.ui.notify("tts: stopped", "info");
    return;
  }

  await startSpeaking(ctx);
}

/** Auto trigger: a new reply supersedes this session's own playback. */
async function autoSpeak(ctx: ExtensionContext): Promise<void> {
  if (!AUTO_SPEAK() || !ctx.hasUI) return;
  stopCurrent();
  await startSpeaking(ctx, true);
}

/**
 * Wait for this session's turn in the playback queue shared with every other
 * pi and Claude Code session, then play the files in order under one ticket.
 */
async function speakFiles(ctx: ExtensionContext, files: string[], signal: AbortSignal): Promise<void> {
  const release = await acquire("pi-" + process.pid, signal, () => ctx.ui.setStatus("tts", "queued…"));
  const stopWave = startWave(ctx);
  try {
    for (const file of files) await play(file, signal);
  } finally {
    stopWave();
    await release();
  }
}

async function startSpeaking(ctx: ExtensionContext, chime = false): Promise<void> {
  const msg = lastAssistantMessage(ctx);
  if (!msg) {
    ctx.ui.notify("tts: no assistant message yet", "warning");
    return;
  }

  const label = sessionLabel(ctx);
  const cacheKey = `${msg.id}:${label}:${TTS_MODEL()}:${TTS_VOICE()}:${SUMMARY_MODEL()}:${TTS_LANGUAGE()}`;
  const controller = new AbortController();
  // The chime shares the ticket with the speech so nothing can play in between.
  const prelude: string[] = [];
  if (chime) {
    try {
      prelude.push(await getAlertSoundFile());
    } catch {
      // A missing chime should not block speaking.
    }
  }

  const cachedFile = await getCachedAudio(cacheKey);
  if (cachedFile) {
    const run = { controller, file: cachedFile };
    current = run;
    try {
      await speakFiles(ctx, prelude.concat(cachedFile), controller.signal);
    } catch (err) {
      if (String(err) !== "aborted" && !controller.signal.aborted) {
        ctx.ui.notify("tts: " + String(err), "error");
      }
    } finally {
      if (current === run) {
        current = undefined;
        ctx.ui.setStatus("tts", undefined);
      }
    }
    return;
  }

  // Unique per run so a superseded run's cleanup can't delete the new file.
  const file = join(tmpdir(), "pi-tts-" + process.pid + "-" + ++runSeq + ".wav");
  const run = { controller, file };
  current = run;

  let cached = false;
  try {
    ctx.ui.setStatus("tts", "summarizing…");
    const summary = await summarize(msg, controller.signal);

    ctx.ui.setStatus("tts", "synthesizing…");
    const audio = await synthesize((label + ". " + summary).slice(0, MAX_SPEECH_CHARS), controller.signal);

    await writeFile(file, audio);
    cacheAudio(cacheKey, file);
    cached = true;

    await speakFiles(ctx, prelude.concat(file), controller.signal);
  } catch (err) {
    if (String(err) !== "aborted" && !controller.signal.aborted) {
      ctx.ui.notify("tts: " + String(err), "error");
    }
  } finally {
    if (!cached) {
      await unlink(file).catch(() => {});
    }
    // Only the active run owns the shared state; a superseded run must not clobber it.
    if (current === run) {
      current = undefined;
      ctx.ui.setStatus("tts", undefined);
    }
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("speak", {
    description: "Summarize the last agent reply and play it as speech (again: stop)",
    handler: async (_args, ctx) => speakLastMessage(ctx),
  });

  pi.registerShortcut("ctrl+alt+s", {
    description: "Speak summary of last agent reply",
    handler: (ctx) => speakLastMessage(ctx),
  });

  // Handlers are awaited by the extension runner, and the agent only finishes
  // settling once they resolve. Speaking must not hold the session hostage.
  pi.on("agent_settled", (_event, ctx) => {
    // Subagent panes (extensions/subagents) report to their launcher, not aloud.
    if (process.env.PI_SUBAGENT_TASK) return;
    void autoSpeak(ctx).catch(() => {});
  });

  pi.on("session_shutdown", () => {
    stopCurrent();
    cleanupFiles();
  });

  process.on("exit", () => {
    releaseAllSync();
    cleanupFiles();
  });
}
