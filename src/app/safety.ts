import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UberError } from "./errors.js";
import { paths, privateDir } from "./paths.js";

export type PendingAction<T> = {
  token: string;
  action: string;
  profile: string;
  createdAt: string;
  expiresAt: string;
  summary: Record<string, unknown>;
  payload: T;
};

const TOKEN = /^[a-z]{2}_[a-z0-9]{12}$/;

const pendingFile = (token: string): string => join(privateDir(paths().pending), `${token}.json`);

function sweepExpired(): void {
  const dir = privateDir(paths().pending);
  const now = Date.now();
  for (const name of readdirSync(dir)) {
    try {
      const pending = JSON.parse(readFileSync(join(dir, name), "utf8")) as PendingAction<unknown>;
      if (Date.parse(pending.expiresAt) < now - 3_600_000) rmSync(join(dir, name), { force: true });
    } catch {
      rmSync(join(dir, name), { force: true });
    }
  }
}

export function createPending<T>(
  prefix: string,
  action: string,
  profile: string,
  summary: Record<string, unknown>,
  payload: T,
  expiresAt: Date,
): PendingAction<T> {
  sweepExpired();
  const token = `${prefix}_${randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(12, "0").slice(0, 12)}`;
  const pending: PendingAction<T> = {
    token,
    action,
    profile,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    summary,
    payload,
  };
  writeFileSync(pendingFile(token), JSON.stringify(pending), { mode: 0o600 });
  return pending;
}

export function takePending<T>(token: string, action: string, profile: string): PendingAction<T> {
  const file = TOKEN.test(token) ? pendingFile(token) : null;
  if (!file || !existsSync(file)) {
    throw new UberError("blocked.confirm", `Unknown or already used confirm token "${token}".`, "Run the command again without --confirm to get a fresh preview.");
  }
  const pending = JSON.parse(readFileSync(file, "utf8")) as PendingAction<T>;
  if (pending.action !== action || pending.profile !== profile) {
    throw new UberError("blocked.confirm", `Token ${token} belongs to a different action or profile.`);
  }
  rmSync(file, { force: true });
  return pending;
}

export function purgePending(): number {
  const dir = privateDir(paths().pending);
  const names = readdirSync(dir);
  for (const name of names) rmSync(join(dir, name), { force: true });
  return names.length;
}

export function assertWritesAllowed(token?: string): void {
  const file = paths().killswitch;
  if (!existsSync(file)) return;
  if (token && TOKEN.test(token)) rmSync(pendingFile(token), { force: true });
  const reason = readFileSync(file, "utf8").trim();
  throw new UberError(
    "blocked.killswitch",
    reason ? `Money actions are frozen: ${reason}` : "Money actions are frozen by the killswitch.",
    `Run \`uber killswitch off\` (or delete ${file}) to resume. Reads still work.`,
  );
}

export function setKillswitch(on: boolean, reason = ""): { active: boolean; file: string; tokensRevoked: number } {
  const file = paths().killswitch;
  privateDir(paths().home);
  if (!on) {
    rmSync(file, { force: true });
    return { active: false, file, tokensRevoked: 0 };
  }
  writeFileSync(file, reason, { mode: 0o600 });
  return { active: true, file, tokensRevoked: purgePending() };
}

export const killswitchActive = (): boolean => existsSync(paths().killswitch);

export type AuditEntry = {
  action: string;
  profile: string;
  outcome: "started" | "succeeded" | "failed";
  token?: string;
  detail?: Record<string, unknown>;
};

export function audit(entry: AuditEntry): void {
  const month = new Date().toISOString().slice(0, 7);
  const file = join(privateDir(paths().audit), `${month}.jsonl`);
  appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
}

export function readAudit(limit: number): Record<string, unknown>[] {
  const dir = privateDir(paths().audit);
  const lines = readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) => readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean));
  return lines.slice(-limit).map((line) => JSON.parse(line) as Record<string, unknown>);
}
