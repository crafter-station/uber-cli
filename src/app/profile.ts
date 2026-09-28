import { UberError } from "./errors.js";

export const DEFAULT_PROFILE = "default";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function selectProfile(flag: unknown, env: NodeJS.ProcessEnv = process.env): string {
  const chosen = typeof flag === "string" ? flag : env.UBER_PROFILE?.trim() || DEFAULT_PROFILE;
  if (!NAME.test(chosen)) {
    throw new UberError("usage", `"${chosen}" is not a valid profile name.`, "Use letters, digits, dots, dashes or underscores.");
  }
  return chosen;
}
