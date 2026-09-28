import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { asUberError } from "../app/errors.js";
import type { Command } from "../commands/define.js";
import { COMMANDS, toolName } from "../commands/index.js";
import { execute } from "../runtime.js";
import { VERSION } from "../version.js";
import { announce, logCall } from "./console.js";

const INSTRUCTIONS = `Uber for agents: rides, live fares, trips, receipts and Uber Eats for the signed-in rider.

Sign-in: if a tool says the session is missing, call uber_login with the rider's phone (+country code), ask the rider for the SMS code, then call uber_login with that code.

Places: from/to accept a saved place label (home, work, or any label in uber_places_saved), "lat,lng", a Google place id, or free text (the top search match is used and echoed back as pickup/dropoff; check it).

Money rules, always:
1. uber_rides_request and uber_rides_cancel without "confirm" only preview. Nothing is booked or cancelled.
2. Show the rider the ride, fare, pickup, dropoff and payment from the preview and wait for an explicit yes.
3. Only then call again with confirm set to the preview's confirmToken. Never confirm on your own initiative.
4. The approved fare is a ceiling: if the price rose, nothing is booked and a new preview comes back.`;

const annotations = (command: Command) => ({
  title: command.summary,
  readOnlyHint: command.risk === "read",
  destructiveHint: command.risk === "money",
  idempotentHint: command.risk === "read",
  openWorldHint: true,
});

const describe = (command: Command): string =>
  [command.summary + ".", command.guidance, `CLI: ${command.examples[0] ?? `uber ${command.name}`}`].filter(Boolean).join("\n\n");

export const MCP_COMMANDS = COMMANDS.filter((candidate) => candidate.mcp !== false);

export async function serveMcp(profile: string): Promise<void> {
  const server = new McpServer({ name: "uber", version: VERSION }, { instructions: INSTRUCTIONS });

  for (const command of MCP_COMMANDS) {
    server.registerTool(
      toolName(command),
      { description: describe(command), inputSchema: command.input, annotations: annotations(command) },
      async (input: Record<string, unknown>) => {
        const startedAt = Date.now();
        try {
          const outcome = await execute(command, input, { profile, interactive: false, headed: false, progress: () => {} });
          logCall(toolName(command), true, startedAt);
          const payload = { ok: true, result: outcome.result, ...(outcome.next?.length ? { nextSteps: outcome.next } : {}) };
          return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
        } catch (caught) {
          const error = asUberError(caught);
          logCall(toolName(command), false, startedAt, error.code);
          const payload = { ok: false, error: { code: error.code, message: error.message, hint: error.hint, retryable: error.retryable } };
          return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
        }
      },
    );
  }

  await server.connect(new StdioServerTransport());
  announce(profile, MCP_COMMANDS.length, Boolean(process.stdin.isTTY));
  await new Promise<void>((resolve) => {
    process.stdin.on("close", resolve);
  });
}
