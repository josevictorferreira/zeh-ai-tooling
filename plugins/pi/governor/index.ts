import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type ToolCallEvent,
  type ToolCallEventResult,
  type ToolResultEvent,
  type ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";
import {
  compactToolOutput,
  pruneOldSpills,
  spillPathFor,
  writeSpillFile,
  type CompactionConfig,
} from "./compactor.ts";
import {
  formatStatus,
  isProfileName,
  nextSteering,
  phaseFor,
  PROFILES,
  type Phase,
  type Profile,
  type ProfileName,
} from "./profiles.ts";

export interface GovernorConfig extends CompactionConfig {
  enabled: boolean;
  profile: ProfileName;
  compactTools: Set<string>;
}

export interface RunState {
  profile: ProfileName;
  count: number;
  blocked: number;
  hasBlockedThisTurn: boolean;
  hasBlockedInPriorTurn: boolean;
  lastSteerPhase: Phase;
  lastSteerCount: number;
  compactions: number;
  charsSaved: number;
}

const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_HEAD_CHARS = 2400;
const DEFAULT_TAIL_CHARS = 900;
const DEFAULT_COMPACT_TOOLS = "bash,grep,find,ls";

function parsePositiveInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = Number.parseInt(val, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadGovernorConfig(): GovernorConfig {
  const envEnabled = process.env.PI_GOVERNOR_ENABLED ?? "1";
  const enabled = !(envEnabled === "0" || envEnabled.toLowerCase() === "false" || envEnabled.toLowerCase() === "off");

  let profile: ProfileName = "standard";
  const envProfile = (process.env.PI_GOVERNOR_PROFILE ?? "standard").trim().toLowerCase();
  if (isProfileName(envProfile)) {
    profile = envProfile;
  }

  const maxChars = parsePositiveInt(process.env.PI_GOVERNOR_MAX_CHARS, DEFAULT_MAX_CHARS);
  const headChars = parsePositiveInt(process.env.PI_GOVERNOR_HEAD_CHARS, DEFAULT_HEAD_CHARS);
  const tailChars = parsePositiveInt(process.env.PI_GOVERNOR_TAIL_CHARS, DEFAULT_TAIL_CHARS);

  const rawTools = (process.env.PI_GOVERNOR_COMPACT_TOOLS ?? DEFAULT_COMPACT_TOOLS)
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  // read, edit, write are never compacted regardless of config
  const compactTools = new Set(
    rawTools.filter((t) => t !== "read" && t !== "edit" && t !== "write"),
  );

  return {
    enabled,
    profile,
    maxChars,
    headChars,
    tailChars,
    compactTools,
  };
}

export function createInitialRunState(profile: ProfileName): RunState {
  return {
    profile,
    count: 0,
    blocked: 0,
    hasBlockedThisTurn: false,
    hasBlockedInPriorTurn: false,
    lastSteerPhase: "normal",
    lastSteerCount: 0,
    compactions: 0,
    charsSaved: 0,
  };
}

export function createGovernorExtension() {
  return function (pi: ExtensionAPI): void {
    const config = loadGovernorConfig();
    if (!config.enabled) {
      return;
    }

    const state = createInitialRunState(config.profile);
    const agentDir = getAgentDir();
    let hasPruned = false;

    // Warn if unknown profile was provided via environment
    const rawEnvProfile = (process.env.PI_GOVERNOR_PROFILE ?? "").trim();
    if (rawEnvProfile && !isProfileName(rawEnvProfile.toLowerCase())) {
      // Defer notification until first context with UI
      let warned = false;
      pi.on("before_agent_start", async (_event, ctx) => {
        if (!warned && ctx.hasUI) {
          ctx.ui.notify(
            `Governor: unknown profile "${rawEnvProfile}", falling back to standard`,
            "warning",
          );
          warned = true;
        }
      });
    }

    function updateStatus(ctx: ExtensionContext): void {
      if (!ctx.hasUI) return;
      const profile = PROFILES[state.profile];
      const status = formatStatus(profile, state.count, state.blocked);
      ctx.ui.setStatus("governor", status);
    }

    // Prune old spills once per session / startup
    pi.on("session_start", async (_event, ctx) => {
      if (!hasPruned) {
        hasPruned = true;
        void pruneOldSpills(agentDir, ctx.cwd);
      }
    });

    pi.on("before_agent_start", async (_event, ctx) => {
      // Reset counters per agent run
      state.count = 0;
      state.blocked = 0;
      state.hasBlockedThisTurn = false;
      state.hasBlockedInPriorTurn = false;
      state.lastSteerPhase = "normal";
      state.lastSteerCount = 0;
      state.compactions = 0;
      state.charsSaved = 0;

      if (!hasPruned) {
        hasPruned = true;
        void pruneOldSpills(agentDir, ctx.cwd);
      }

      updateStatus(ctx);
    });

    pi.on("turn_end", async () => {
      if (state.hasBlockedThisTurn) {
        state.hasBlockedInPriorTurn = true;
      }
    });

    pi.on("tool_call", async (event: ToolCallEvent, ctx): Promise<ToolCallEventResult | void> => {
      // Skip nested tool calls and inactive profiles
      if (event.parentToolCallId || state.profile === "off") {
        return;
      }

      const profile = PROFILES[state.profile];
      if (state.count >= profile.finalizeAfter) {
        state.blocked += 1;
        state.hasBlockedThisTurn = true;
        updateStatus(ctx);

        const reason = `Tool budget exhausted (${profile.finalizeAfter}/${profile.finalizeAfter}). No further tool calls will run in this turn. Keep the current changes and write the final answer from the evidence you already have; say what is unverified.`;

        // If the model called tools again in a later turn after being halted, terminate immediately.
        if (state.hasBlockedInPriorTurn) {
          return {
            block: true,
            reason,
            terminate: true,
          };
        }

        return {
          block: true,
          reason,
        };
      }

      state.count += 1;
      updateStatus(ctx);
    });

    pi.on("tool_result", async (event: ToolResultEvent, ctx): Promise<ToolResultEventResult | void> => {
      // Skip nested tool results
      if (event.parentToolCallId || state.profile === "off") {
        return;
      }

      try {
        const profile = PROFILES[state.profile];

        // 1. Compute steering synchronously before any await to avoid duplicate steering in parallel batches
        const steering = nextSteering(
          profile,
          state.count,
          state.lastSteerPhase,
          state.lastSteerCount,
        );
        if (steering) {
          state.lastSteerPhase = steering.phase;
          state.lastSteerCount = state.count;
        }

        // 2. Perform compaction if tool is eligible
        let contentModified = false;
        const newContent = await Promise.all(
          event.content.map(async (block) => {
            if (block.type !== "text" || !config.compactTools.has(event.toolName)) {
              return block;
            }

            let existingSpillPath: string | undefined;
            if (event.toolName === "bash" && event.details && typeof event.details === "object") {
              const details = event.details as { fullOutputPath?: string };
              if (typeof details.fullOutputPath === "string") {
                existingSpillPath = details.fullOutputPath;
              }
            }

            const sessionId = ctx.sessionManager?.getSessionId?.() ?? "unknown-session";
            const res = await compactToolOutput(block.text, {
              maxChars: config.maxChars,
              headChars: config.headChars,
              tailChars: config.tailChars,
              existingSpillPath,
              writeSpill: async (raw) => {
                const dest = spillPathFor(agentDir, ctx.cwd, sessionId, event.toolCallId);
                const ok = await writeSpillFile(dest, raw);
                return ok ? dest : undefined;
              },
            });

            if (res) {
              contentModified = true;
              state.compactions += 1;
              state.charsSaved += res.charsSaved;
              return { ...block, text: res.text };
            }

            return block;
          }),
        );

        // 3. Inject steering reminder if scheduled
        if (steering) {
          contentModified = true;
          const steerBlock: TextContent = {
            type: "text",
            text: steering.text,
          };
          newContent.push(steerBlock);
        }

        if (contentModified) {
          return {
            content: newContent,
            structuredContent: event.structuredContent,
            details: event.details,
          };
        }

        return undefined;
      } catch {
        // Fail open: leave the tool result unchanged on any error
        return undefined;
      }
    });

    pi.on("agent_settled", async (_event, ctx) => {
      if (state.count > 0 || state.blocked > 0 || state.compactions > 0) {
        const profile = PROFILES[state.profile];
        const finalPhase = state.blocked > 0 ? "halt" : phaseFor(profile, state.count);
        pi.appendEntry("governor-run", {
          profile: state.profile,
          count: state.count,
          blocked: state.blocked,
          finalPhase,
          compactions: state.compactions,
          charsSaved: state.charsSaved,
        });
      }
      updateStatus(ctx);
    });

    // Slash command /governor
    pi.registerCommand("governor", {
      description: "Inspect or tune the Governor budget and steering profile",
      getArgumentCompletions: async (prefix: string) => {
        const options = [
          { value: "set lean", label: "set lean", description: "Profile: lean (20 finalize)" },
          { value: "set standard", label: "set standard", description: "Profile: standard (44 finalize)" },
          { value: "set deep", label: "set deep", description: "Profile: deep (60 finalize)" },
          { value: "set off", label: "set off", description: "Profile: off (disabled)" },
          { value: "reset", label: "reset", description: "Reset run counters and steering state" },
        ];
        const p = prefix.trim().toLowerCase();
        return options.filter((opt) => opt.value.startsWith(p));
      },
      handler: async (args: string, ctx: ExtensionCommandContext) => {
        const trimmed = args.trim();
        const profile = PROFILES[state.profile];

        if (trimmed === "") {
          const phase = phaseFor(profile, state.count);
          const cwdSlug = ctx.cwd.replace(/[^A-Za-z0-9]/g, "-");
          const spillDir = `${agentDir}/governor/${cwdSlug}`;
          const msg = [
            `Governor status:`,
            `• Profile: ${state.profile} (econ: ${profile.economyAfter}, conv: ${profile.convergenceAfter}, finalize: ${profile.finalizeAfter})`,
            `• Phase: ${phase}`,
            `• Tool calls this run: ${state.count} allowed, ${state.blocked} blocked`,
            `• Compactions this run: ${state.compactions} (${state.charsSaved.toLocaleString("en-US")} chars saved)`,
            `• Spill dir: ${spillDir}`,
          ].join("\n");
          ctx.ui.notify(msg, "info");
          return;
        }

        if (trimmed.startsWith("set ")) {
          const target = trimmed.slice(4).trim().toLowerCase();
          if (isProfileName(target)) {
            state.profile = target;
            updateStatus(ctx);
            const newP = PROFILES[target];
            if (target === "off") {
              ctx.ui.notify("Governor profile set to off (budget and compaction inactive)", "info");
            } else {
              ctx.ui.notify(
                `Governor profile set to ${target} (economy: ${newP.economyAfter}, convergence: ${newP.convergenceAfter}, finalize: ${newP.finalizeAfter})`,
                "info",
              );
            }
            return;
          }
          ctx.ui.notify(
            `Unknown profile "${target}". Valid options: lean, standard, deep, off`,
            "error",
          );
          return;
        }

        if (trimmed === "reset") {
          state.count = 0;
          state.blocked = 0;
          state.hasBlockedThisTurn = false;
          state.hasBlockedInPriorTurn = false;
          state.lastSteerPhase = "normal";
          state.lastSteerCount = 0;
          state.compactions = 0;
          state.charsSaved = 0;
          updateStatus(ctx);
          ctx.ui.notify("Governor run counters reset", "info");
          return;
        }

        ctx.ui.notify("Usage: /governor [set <lean|standard|deep|off> | reset]", "warning");
      },
    });
  };
}

export default createGovernorExtension();
