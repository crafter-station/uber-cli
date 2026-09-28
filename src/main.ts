import { asUberError, UberError } from "./app/errors.js";
import { selectProfile } from "./app/profile.js";
import { parseInvocation, buildInput } from "./cli/argv.js";
import { commandHelp, globalHelp } from "./cli/help.js";
import { detectMode, emitFailure, emitSuccess, progressWriter } from "./cli/output.js";
import { COMMANDS } from "./commands/index.js";
import { EXIT, type ExitCode } from "./contract.js";
import { setVisualMode } from "./cli/visual.js";
import { execute } from "./runtime.js";
import { VERSION } from "./version.js";

export async function main(argv: string[] = process.argv.slice(2)): Promise<ExitCode> {
  let mode = detectMode(argv.includes("--json"));
  let label = argv.filter((token) => !token.startsWith("-")).slice(0, 2).join(" ") || "uber";
  let profile = "default";

  try {
    if (argv[0] === "mcp") {
      const { flags } = parseInvocation(argv.slice(1), COMMANDS);
      const { MCP_COMMANDS, serveMcp } = await import("./mcp/server.js");
      if (flags.help === true) {
        const { mcpHelp } = await import("./mcp/console.js");
        process.stdout.write(`${mcpHelp(MCP_COMMANDS.length)}\n`);
        return EXIT.ok;
      }
      await serveMcp(selectProfile(flags.profile));
      return EXIT.ok;
    }

    const { command, words, flags } = parseInvocation(argv, COMMANDS);
    mode = detectMode(flags.json === true);
    profile = selectProfile(flags.profile);
    setVisualMode(flags.map);

    if (flags.version === true || flags.v === true) {
      process.stdout.write(`${VERSION}\n`);
      return EXIT.ok;
    }
    if (!command) {
      if (words.length === 0 || flags.help === true) {
        process.stdout.write(`${globalHelp()}\n`);
        return EXIT.ok;
      }
      throw new UberError("usage", `Unknown command "${words.join(" ")}".`, "Run `uber --help` for the list.");
    }
    label = command.name;
    if (flags.help === true) {
      process.stdout.write(`${commandHelp(command)}\n`);
      return EXIT.ok;
    }

    const input = buildInput(command, words, flags);
    const outcome = await execute(command, input, {
      profile,
      interactive: mode === "human" && Boolean(process.stdin.isTTY),
      headed: flags.headed === true,
      progress: progressWriter(mode),
    });
    await emitSuccess(mode, command.name, profile, outcome.result, outcome.next ?? [], command.render as ((value: unknown) => string | Promise<string>) | undefined);
    return EXIT.ok;
  } catch (caught) {
    const error = asUberError(caught);
    emitFailure(mode, label, profile, error);
    return error.exitCode;
  }
}
