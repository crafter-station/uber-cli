import { existsSync } from "node:fs";
import { z } from "zod";
import { paths } from "../app/paths.js";
import { killswitchActive, readAudit, setKillswitch } from "../app/safety.js";
import { agentBrowserVersion } from "../browser/agent-browser.js";
import { style, table } from "../cli/style.js";
import { macKeychain } from "../session/keychain.js";
import { hasSessionFile, loadSession, resolveKey } from "../session/vault.js";
import { defineCommand, step, withProfile } from "./define.js";

type Check = { name: string; ok: boolean; detail: string };

export const doctor = defineCommand({
  name: "doctor",
  summary: "Check agent-browser, the Keychain, the stored session and the killswitch",
  risk: "local",
  input: {},
  examples: ["uber doctor"],
  async run(_input, context) {
    const browser = agentBrowserVersion();
    const key = resolveKey(context.profile);
    const session = loadSession(context.profile);
    const ageHours = session ? (Date.now() - Date.parse(session.savedAt)) / 3_600_000 : null;
    const checks: Check[] = [
      { name: "node", ok: Number(process.versions.node.split(".")[0]) >= 20, detail: process.versions.node },
      { name: "agent-browser", ok: browser !== null, detail: browser ?? "missing: npm i -g agent-browser && agent-browser install" },
      { name: "keychain", ok: macKeychain.available(), detail: macKeychain.available() ? "macOS Keychain" : "unavailable: set UBER_SESSION_KEY or a key file is used" },
      { name: "session key", ok: key !== null, detail: key?.source ?? "none yet" },
      {
        name: "session",
        ok: session !== null,
        detail: session
          ? `${session.cookies.length} cookies, saved ${ageHours !== null ? `${ageHours.toFixed(1)}h` : "?"} ago`
          : hasSessionFile(context.profile)
            ? "present but cannot be decrypted (key missing?)"
            : "not signed in",
      },
      { name: "killswitch", ok: !killswitchActive(), detail: killswitchActive() ? "ON: money actions are frozen" : "off" },
      { name: "home", ok: existsSync(paths().home), detail: paths().home },
    ];
    return {
      result: { profile: context.profile, healthy: checks.every((check) => check.ok), checks },
      next: session ? [] : [step(withProfile("uber login", context.profile), "Sign in")],
    };
  },
  render: (result) => table(result.checks.map((check) => [check.ok ? style.green("●") : style.red("○"), check.name, style.muted(check.detail)])),
});

export const killswitch = defineCommand({
  name: "killswitch",
  summary: "Freeze or unfreeze every money action (ride requests and cancellations)",
  risk: "local",
  mcp: false,
  input: {
    state: z.enum(["on", "off", "status"]).default("status"),
    reason: z.string().optional().describe("Shown to whoever hits the freeze"),
  },
  positionals: ["state"],
  examples: ["uber killswitch on --reason \"demo in progress\"", "uber killswitch off", "uber killswitch"],
  async run(input) {
    if (input.state === "status") return { result: { active: killswitchActive(), file: paths().killswitch, tokensRevoked: 0 } };
    return { result: setKillswitch(input.state === "on", input.reason) };
  },
  render: (result) =>
    result.active
      ? `${style.red("●")} Money actions frozen${result.tokensRevoked > 0 ? style.muted(` · ${result.tokensRevoked} pending confirmation(s) revoked`) : ""}`
      : `${style.green("○")} Killswitch off`,
});

export const auditLog = defineCommand({
  name: "audit",
  summary: "Recent money actions: every request and cancel, with outcome",
  risk: "local",
  input: { limit: z.coerce.number().int().min(1).max(500).default(20) },
  examples: ["uber audit", "uber audit --limit 100"],
  async run(input) {
    return { result: readAudit(input.limit) };
  },
  render: (entries) =>
    entries.length === 0
      ? style.muted("No money actions yet.")
      : table(entries.map((entry) => [style.muted(String(entry.at).slice(0, 19).replace("T", " ")), String(entry.action), String(entry.outcome), style.muted(JSON.stringify(entry.detail ?? {}))])),
});
