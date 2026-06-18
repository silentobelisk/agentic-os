import os from "node:os";
import path from "node:path";

// Resolve the Claude Code home and its sub-paths. Honors CLAUDE_CONFIG_DIR
// if set, otherwise ~/.claude.
export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

export function projectsDir(): string {
  return path.join(claudeHome(), "projects");
}

export function globalSkillsDir(): string {
  return path.join(claudeHome(), "skills");
}

export function pluginsDir(): string {
  return path.join(claudeHome(), "plugins");
}

export function commandsDir(): string {
  return path.join(claudeHome(), "commands");
}
