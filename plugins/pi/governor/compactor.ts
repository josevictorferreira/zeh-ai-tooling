import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface CompactionConfig {
  maxChars: number;
  headChars: number;
  tailChars: number;
}

export interface CompactResult {
  text: string;
  compacted: boolean;
  spillPath?: string;
  charsSaved: number;
}

/**
 * Sanitise a tool call ID for use as a file name.
 * Provider IDs can contain slashes, colons, or pipes.
 */
export function sanitizeToolCallId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Build the absolute path where a spill file should live.
 * Spills live under ~/.pi/agent/governor/<cwd-slug>/<session-id>/<tool-call-id>.txt
 */
export function spillPathFor(
  agentDir: string,
  cwd: string,
  sessionId: string,
  toolCallId: string,
): string {
  const cwdSlug = cwd.replace(/[^A-Za-z0-9]/g, "-");
  const cleanId = sanitizeToolCallId(toolCallId);
  return join(agentDir, "governor", cwdSlug, sessionId, `${cleanId}.txt`);
}

/**
 * Safely write un-deduplicated text to a spill file.
 * Returns true if write succeeded, false on any filesystem error.
 */
export async function writeSpillFile(path: string, text: string): Promise<boolean> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Prune spill files for the given project that are older than maxAgeMs (default 7 days).
 * Fire-and-forget; never throws.
 */
export async function pruneOldSpills(
  agentDir: string,
  cwd: string,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000,
): Promise<void> {
  try {
    const cwdSlug = cwd.replace(/[^A-Za-z0-9]/g, "-");
    const projectDir = join(agentDir, "governor", cwdSlug);
    const now = Date.now();

    const walkAndPrune = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walkAndPrune(full);
        } else if (entry.isFile()) {
          try {
            const st = await stat(full);
            if (now - st.mtimeMs > maxAgeMs) {
              await rm(full, { force: true });
            }
          } catch {
            // Ignore stat / remove errors
          }
        }
      }
    };

    await walkAndPrune(projectDir);
  } catch {
    // Ignore all pruning errors
  }
}

/**
 * Collapse consecutive duplicate lines into line + "[previous line repeated N times]".
 */
export function collapseRepeatedLines(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= 1) return text;

  const deduped: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    let nextIndex = index + 1;
    while (nextIndex < lines.length && lines[nextIndex] === line) {
      nextIndex++;
    }

    deduped.push(line);
    const repeats = nextIndex - index - 1;
    if (repeats > 1) {
      deduped.push(`[previous line repeated ${repeats} times]`);
    } else if (repeats === 1) {
      deduped.push(line);
    }

    index = nextIndex;
  }

  return deduped.join("\n");
}

/**
 * Cut head and tail of text, respecting line boundaries where a newline exists inside the slice.
 */
export function cutHeadTail(
  text: string,
  headChars: number,
  tailChars: number,
): { head: string; tail: string; omittedChars: number } {
  if (text.length <= headChars + tailChars) {
    return { head: text, tail: "", omittedChars: 0 };
  }

  // Slice candidate head
  let headSlice = text.slice(0, headChars);
  const lastHeadNewline = headSlice.lastIndexOf("\n");
  if (lastHeadNewline > 0) {
    headSlice = headSlice.slice(0, lastHeadNewline);
  }

  // Slice candidate tail
  let tailSlice = text.slice(text.length - tailChars);
  const firstTailNewline = tailSlice.indexOf("\n");
  if (firstTailNewline >= 0 && firstTailNewline < tailSlice.length - 1) {
    tailSlice = tailSlice.slice(firstTailNewline + 1);
  }

  const omittedChars = text.length - headSlice.length - tailSlice.length;
  return {
    head: headSlice,
    tail: tailSlice,
    omittedChars,
  };
}

/**
 * Format the replacement text for a compacted tool result.
 */
export function formatCompactedText(
  originalLen: number,
  head: string,
  tail: string,
  omittedChars: number,
  spillPath: string,
): string {
  const compactedLen = head.length + tail.length;
  const header = `[Governor: output compacted from ${originalLen.toLocaleString("en-US")} to ${compactedLen.toLocaleString("en-US")} chars. Full output: ${spillPath}]`;
  const marker = `... [${omittedChars.toLocaleString("en-US")} chars omitted; read the file above with offset/limit for a specific section] ...`;

  if (tail.length > 0) {
    return `${header}\n${head}\n${marker}\n${tail}`;
  }
  return `${header}\n${head}\n${marker}`;
}

export interface CompactOptions extends CompactionConfig {
  existingSpillPath?: string;
  writeSpill?: (text: string) => Promise<string | undefined>;
}

/**
 * Main compaction function:
 * 1. If text <= maxChars: return undefined (untouched).
 * 2. Collapse repeated consecutive lines. If now <= maxChars, return collapsed text without spill.
 * 3. If still > maxChars, obtain a spill path (existingSpillPath or writeSpill(originalText)).
 *    If spill writing fails, return undefined (fail open, no cut without readable spill).
 * 4. Cut head/tail and return formatted compacted text.
 */
export async function compactToolOutput(
  text: string,
  options: CompactOptions,
): Promise<CompactResult | undefined> {
  const originalLen = text.length;
  if (originalLen <= options.maxChars) {
    return undefined;
  }

  const collapsed = collapseRepeatedLines(text);
  if (collapsed.length <= options.maxChars) {
    return {
      text: collapsed,
      compacted: true,
      spillPath: undefined,
      charsSaved: originalLen - collapsed.length,
    };
  }

  let spillPath = options.existingSpillPath;
  if (!spillPath && options.writeSpill) {
    spillPath = await options.writeSpill(text);
  }

  // If we could not obtain or write a spill file, fail open: never cut without a readable full copy!
  if (!spillPath) {
    return undefined;
  }

  const { head, tail, omittedChars } = cutHeadTail(
    collapsed,
    options.headChars,
    options.tailChars,
  );

  const formatted = formatCompactedText(
    originalLen,
    head,
    tail,
    omittedChars,
    spillPath,
  );

  return {
    text: formatted,
    compacted: true,
    spillPath,
    charsSaved: originalLen - formatted.length,
  };
}
