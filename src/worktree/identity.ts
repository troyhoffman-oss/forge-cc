import { execSync } from "node:child_process";
import { userInfo } from "node:os";

export interface UserIdentity {
  name: string;
  email: string;
}

/**
 * Get the current user's identity from git config.
 * Falls back to OS username if git config is not set.
 */
export function getCurrentUser(cwd?: string): UserIdentity {
  let name: string;
  let email: string;

  try {
    name = execSync("git config user.name", {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    name = userInfo().username;
  }

  try {
    email = execSync("git config user.email", {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    email = "unknown";
  }

  return { name, email };
}
