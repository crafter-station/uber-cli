import { style, table } from "../cli/style.js";
import { loadSession } from "../session/vault.js";

const write = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

const profileArgs = (profile: string): string[] => (profile === "default" ? ["mcp"] : ["mcp", "--profile", profile]);

export function setupGuide(profile: string): string {
  const args = profileArgs(profile);
  const json = ["{", '  "mcpServers": {', `    "uber": { "command": "uber", "args": ${JSON.stringify(args)} }`, "  }", "}"].join("\n");
  return [
    style.bold("Connect a client"),
    table(
      [
        ["  Claude Code", style.cyan(`claude mcp add uber -- uber ${args.join(" ")}`)],
        ["  Claude Desktop", style.muted("~/Library/Application Support/Claude/claude_desktop_config.json")],
        ["  Cursor", style.muted("~/.cursor/mcp.json")],
      ],
      3,
    ),
    "",
    style.muted("  JSON for Claude Desktop, Cursor and most clients:"),
    json
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n"),
  ].join("\n");
}

export function mcpHelp(tools: number): string {
  return [
    `${style.bold("uber mcp")}  Serve every uber command as MCP tools over stdio`,
    "",
    `${style.muted("usage")}  uber mcp [--profile <name>]`,
    "",
    `${tools} tools. Reads are marked read-only; uber_rides_request and uber_rides_cancel are marked destructive`,
    "and only book or cancel with a confirm token from a preview the rider approved.",
    "",
    setupGuide("default"),
  ].join("\n");
}

export function announce(profile: string, tools: number, interactive: boolean): void {
  const session = loadSession(profile);
  const account = session?.account?.name;
  const who = session ? `signed in${account ? ` as ${style.bold(account)}` : ""}` : style.yellow("not signed in, tools will ask to run uber_login");
  write(`${style.green("●")} uber MCP server on stdio  ${style.muted(`· ${tools} tools · profile ${profile} ·`)} ${who}`);
  if (!interactive) return;
  write("");
  write(setupGuide(profile));
  write("");
  write(style.muted("Waiting for a client on stdin. Tool calls are logged here. Ctrl+C to stop."));
}

export function logCall(tool: string, ok: boolean, startedAt: number, code?: string): void {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const status = ok ? style.green("ok") : style.red(code ?? "error");
  write(`${style.muted(time)}  ${tool}  ${status}  ${style.muted(`${Date.now() - startedAt}ms`)}`);
}
