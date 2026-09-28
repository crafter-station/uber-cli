import { chmodSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export type AppPaths = {
  home: string;
  profiles: string;
  pending: string;
  audit: string;
  killswitch: string;
};

function root(): string {
  const override = process.env.UBER_HOME?.trim();
  if (override) return override;
  const home = homedir();
  if (platform() === "darwin") return join(home, "Library", "Application Support", "uber");
  if (platform() === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "uber");
  return join(process.env.XDG_STATE_HOME ?? join(home, ".local", "state"), "uber");
}

export function paths(): AppPaths {
  const home = root();
  return {
    home,
    profiles: join(home, "profiles"),
    pending: join(home, "pending"),
    audit: join(home, "audit"),
    killswitch: join(home, "KILLSWITCH"),
  };
}

export function privateDir(path: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

export const profileDir = (profile: string): string => privateDir(join(paths().profiles, profile));

export const browserProfileDir = (profile: string): string => privateDir(join(profileDir(profile), "browser"));
