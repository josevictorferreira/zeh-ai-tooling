export type ProfileName = "lean" | "standard" | "deep" | "unlimited" | "off";
export type Phase = "normal" | "economy" | "convergence" | "halt";

export interface Profile {
  name: ProfileName;
  economyAfter: number;
  convergenceAfter: number;
  reminderEvery: number;
  finalizeAfter: number;
}

export const PROFILES: Record<ProfileName, Profile> = {
  lean: {
    name: "lean",
    economyAfter: 6,
    convergenceAfter: 12,
    reminderEvery: 3,
    finalizeAfter: 20,
  },
  standard: {
    name: "standard",
    economyAfter: 14,
    convergenceAfter: 26,
    reminderEvery: 6,
    finalizeAfter: 44,
  },
  deep: {
    name: "deep",
    economyAfter: 20,
    convergenceAfter: 36,
    reminderEvery: 8,
    finalizeAfter: 60,
  },
  // No budget and no steering, but output compaction stays on.
  unlimited: {
    name: "unlimited",
    economyAfter: Infinity,
    convergenceAfter: Infinity,
    reminderEvery: Infinity,
    finalizeAfter: Infinity,
  },
  off: {
    name: "off",
    economyAfter: Infinity,
    convergenceAfter: Infinity,
    reminderEvery: Infinity,
    finalizeAfter: Infinity,
  },
};

export function isProfileName(value: string): value is ProfileName {
  return value in PROFILES;
}

/**
 * Determine the current phase based on the profile and count of allowed calls.
 */
export function phaseFor(profile: Profile, count: number): Phase {
  if (profile.name === "off") return "normal";
  if (count <= profile.economyAfter) return "normal";
  if (count <= profile.convergenceAfter) return "economy";
  if (count <= profile.finalizeAfter) return "convergence";
  return "halt";
}

export interface SteeringResult {
  phase: Phase;
  text: string;
}

/**
 * Compute the next steering reminder to inject into a tool result, if any.
 *
 * - Driven by phase change and distance since the last reminder, not exact counts.
 * - Injects at most one reminder per decision.
 */
export function nextSteering(
  profile: Profile,
  count: number,
  lastSteerPhase: Phase,
  lastSteerCount: number,
): SteeringResult | undefined {
  if (profile.name === "off") return undefined;

  const currentPhase = phaseFor(profile, count);
  if (currentPhase === "normal" || currentPhase === "halt") {
    return undefined;
  }

  if (currentPhase === "economy") {
    if (lastSteerPhase === "normal") {
      return {
        phase: "economy",
        text: `[Governor: economy, ${count}/${profile.finalizeAfter} tool calls] Batch independent searches and reads into one turn, skip progress narration, and do not re-read unchanged files.`,
      };
    }
    return undefined;
  }

  if (currentPhase === "convergence") {
    const shouldRemind =
      lastSteerPhase !== "convergence" ||
      count - lastSteerCount >= profile.reminderEvery;

    if (shouldRemind) {
      const left = Math.max(0, profile.finalizeAfter - count);
      return {
        phase: "convergence",
        text: `[Governor: convergence, ${count}/${profile.finalizeAfter} tool calls, ${left} left] Stop broad exploration. Verify the exact change, fix concrete failures, remove temporary files, and prepare the final answer.`,
      };
    }
    return undefined;
  }

  return undefined;
}

function shortName(name: ProfileName): string {
  return name === "standard" ? "std" : name;
}

/**
 * Format status text for Pi's UI footer/status bar.
 * Returns undefined when profile is 'off' or governor is disabled.
 */
export function formatStatus(
  profile: Profile,
  count: number,
  blocked: number,
): string | undefined {
  if (profile.name === "off") return undefined;

  if (profile.name === "unlimited") return `♾️ unlimited ${count}`;

  const tag = shortName(profile.name);
  const fin = profile.finalizeAfter;

  if (blocked > 0 || count >= fin) {
    return `🛑 ${tag} halt ${count}/${fin}`;
  }

  const phase = phaseFor(profile, count);
  if (phase === "convergence") {
    return `🔥 ${tag} conv ${count}/${fin}`;
  }
  if (phase === "economy") {
    return `⚡ ${tag} econ ${count}/${fin}`;
  }

  return `🎯 ${tag} ${count}/${fin}`;
}
