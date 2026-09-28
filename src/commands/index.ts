import { z } from "zod";
import { CONTRACT_VERSION, EXIT } from "../contract.js";
import { VERSION } from "../version.js";
import { balance, me, promos, tripsGet, tripsList, tripsReceipt } from "./account.js";
import { authRefresh, authStatus, login, logout } from "./auth.js";
import { type Command, defineCommand } from "./define.js";
import { eatsCartsCommand, eatsMe, eatsOrdersCommand } from "./eats.js";
import { placesSaved, placesSearch } from "./places.js";
import { ridesCancel, ridesEstimate, ridesRequest, ridesStatus } from "./rides.js";
import { auditLog, doctor, killswitch } from "./system.js";

const schema = defineCommand({
  name: "schema",
  summary: "Machine-readable contract: every command, its inputs as JSON Schema, risk and exit codes",
  risk: "local",
  mcp: false,
  input: {},
  examples: ["uber schema --json"],
  async run() {
    return {
      result: {
        name: "uber",
        version: VERSION,
        contract: CONTRACT_VERSION,
        exitCodes: EXIT,
        commands: COMMANDS.map((command) => ({
          name: command.name,
          summary: command.summary,
          guidance: command.guidance ?? null,
          risk: command.risk,
          aliases: command.aliases ?? [],
          positionals: command.variadic ? [command.variadic] : (command.positionals ?? []),
          input: z.toJSONSchema(z.object(command.input)),
          examples: command.examples,
          mcpTool: command.mcp === false ? null : toolName(command),
        })),
      },
    };
  },
});

export const COMMANDS: Command[] = [
  login,
  logout,
  authStatus,
  authRefresh,
  me,
  balance,
  promos,
  tripsList,
  tripsGet,
  tripsReceipt,
  placesSearch,
  placesSaved,
  ridesEstimate,
  ridesRequest,
  ridesStatus,
  ridesCancel,
  eatsMe,
  eatsOrdersCommand,
  eatsCartsCommand,
  doctor,
  auditLog,
  killswitch,
  schema,
] as Command[];

export const toolName = (command: Command): string => `uber_${command.name.replace(/ /g, "_")}`;

export const GROUPS: { title: string; names: string[] }[] = [
  { title: "Account", names: ["login", "logout", "auth status", "auth refresh", "me", "balance", "promos"] },
  { title: "Rides", names: ["rides estimate", "rides request", "rides status", "rides cancel", "places search", "places saved"] },
  { title: "Trips", names: ["trips list", "trips get", "trips receipt"] },
  { title: "Eats", names: ["eats me", "eats orders", "eats carts"] },
  { title: "System", names: ["doctor", "audit", "killswitch", "schema", "mcp"] },
];
