import type { z } from "zod";
import { COMMANDS, GROUPS } from "../commands/index.js";
import type { Command } from "../commands/define.js";
import { VERSION } from "../version.js";
import { isBooleanField, kebab } from "./argv.js";
import { style, table } from "./style.js";
import { banner } from "./visual.js";

const RISK_BADGE: Record<Command["risk"], string> = {
  read: "",
  auth: style.cyan("auth"),
  money: style.yellow("money"),
  local: "",
};

export function globalHelp(): string {
  const byName = new Map(COMMANDS.map((command) => [command.name, command]));
  const sections = GROUPS.map(({ title, names }) => {
    const rows = names.map((name) => {
      const command = byName.get(name);
      return [`  ${name}`, command ? `${command.summary} ${RISK_BADGE[command.risk]}` : "Serve every command as MCP tools over stdio"];
    });
    return `${style.bold(title)}\n${table(rows, 3)}`;
  });
  return [
    banner(),
    "",
    `${style.muted(`v${VERSION}`)}  rides, fares, trips and Eats for agents and humans`,
    "",
    ...sections.flatMap((section) => [section, ""]),
    style.bold("Flags"),
    table(
      [
        ["  --json", "One JSON envelope on stdout (automatic when piped)"],
        ["  --profile <name>", "Use another signed-in account (or UBER_PROFILE)"],
        ["  --headed", "Show the browser during sign-in steps"],
        ["  --map <mode>", "auto, image, braille or off (or UBER_MAP)"],
        ["  -h, --help", "Help for any command"],
      ],
      3,
    ),
    "",
    style.muted("Start with `uber login`, then `uber rides estimate --from home --to \"airport\"`."),
  ].join("\n");
}

function describe(schema: z.ZodType): string {
  return schema.description ?? "";
}

export function commandHelp(command: Command): string {
  const positionals = command.variadic ? [command.variadic] : (command.positionals ?? []);
  const usage = [
    `uber ${command.name}`,
    ...positionals.map((key) => `<${key}${command.variadic === key ? "..." : ""}>`),
    Object.keys(command.input).some((key) => !positionals.includes(key)) ? "[flags]" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const flagRows = Object.entries(command.input)
    .filter(([key]) => !positionals.includes(key))
    .map(([key, schema]) => {
      const zod = schema as z.ZodType;
      return [`  --${kebab(key)}${isBooleanField(zod) ? "" : " <value>"}`, describe(zod)];
    });
  return [
    `${style.bold(command.summary)} ${RISK_BADGE[command.risk]}`,
    "",
    `${style.muted("usage")}  ${usage}`,
    command.guidance ? `\n${command.guidance}` : "",
    flagRows.length > 0 ? `\n${style.bold("Flags")}\n${table(flagRows, 3)}` : "",
    `\n${style.bold("Examples")}\n${command.examples.map((example) => `  ${example}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");
}
