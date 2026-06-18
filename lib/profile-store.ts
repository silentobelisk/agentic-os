import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProfileCard, ProfileResponse } from "./types";

// Nerve Center's own persisted state (independent of ~/.claude). Lives in
// ~/.nerve-center/profile.json so it survives restarts and travels with the user.

// Bump this when the onboarding wizard gains steps that existing operators
// should be re-walked through; isOnboarded() will then re-trigger the flow.
export const CURRENT_ONBOARDING_VERSION = 1;

export interface StoredProfile {
  name?: string;
  bio?: string;
  brainPath?: string;
  cards?: ProfileCard[];
  analyzedAt?: number;
  fileCount?: number;
  source?: "ai" | "stats";
  onboardedAt?: number; // epoch ms, stamped once the first-run wizard finishes
  onboardingVersion?: number; // which wizard version they completed
}

function dataDir(): string {
  return process.env.NERVE_DATA_DIR || path.join(os.homedir(), ".nerve-center");
}

function profilePath(): string {
  return path.join(dataDir(), "profile.json");
}

export function readProfile(): StoredProfile {
  try {
    return JSON.parse(fs.readFileSync(profilePath(), "utf8")) as StoredProfile;
  } catch {
    return {};
  }
}

export function writeProfile(next: StoredProfile): boolean {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    // Write atomically (tmp + rename) so a crash mid-write can't leave a
    // truncated profile.json that readProfile() would silently treat as {}.
    const tmp = profilePath() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, profilePath());
    return true;
  } catch {
    return false; // best-effort persistence (e.g. read-only data dir)
  }
}

export function mergeProfile(patch: Partial<StoredProfile>): StoredProfile {
  const next = { ...readProfile(), ...patch };
  writeProfile(next);
  return next;
}

// First-run check, read server-side (node:fs). A brand-new machine has no
// profile.json → readProfile() returns {} → not onboarded. We also gate on the
// version so a future expanded wizard can re-run for existing operators.
export function isOnboarded(): boolean {
  const p = readProfile();
  return !!p.onboardedAt && (p.onboardingVersion ?? 0) >= CURRENT_ONBOARDING_VERSION;
}

function isDir(p?: string): boolean {
  if (!p) return false;
  let abs = p.trim();
  if (abs.startsWith("~")) abs = path.join(os.homedir(), abs.slice(1));
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

export function toResponse(s: StoredProfile): ProfileResponse {
  return {
    name: s.name || "",
    bio: s.bio || "",
    brainPath: s.brainPath || "",
    connected: isDir(s.brainPath),
    cards: s.cards || [],
    analyzedAt: s.analyzedAt ?? null,
    fileCount: s.fileCount ?? null,
    source: s.source ?? null,
    onboardedAt: s.onboardedAt ?? null,
    onboardingVersion: s.onboardingVersion ?? null,
  };
}
