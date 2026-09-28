import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { UberError } from "../app/errors.js";
import { COMMANDS } from "../commands/index.js";
import { VERSION } from "../version.js";
import { buildInput, parseInvocation } from "./argv.js";

const invoke = (line: string[]) => {
  const { command, words, flags } = parseInvocation(line, COMMANDS);
  if (!command) throw new Error("no command");
  return { name: command.name, input: buildInput(command, words, flags), flags };
};

const failure = (line: string[]): string => {
  try {
    invoke(line);
    return "none";
  } catch (error) {
    return error instanceof UberError ? error.code : "other";
  }
};

describe("argv", () => {
  test("longest command wins and flags map to camelCase", () => {
    const parsed = invoke(["rides", "request", "--from", "home", "--to=work", "--product", "Moto", "--max-fare", "20000"]);
    expect(parsed.name).toBe("rides request");
    expect(parsed.input).toMatchObject({ from: "home", to: "work", product: "Moto", maxFare: 20000 });
  });

  test("aliases and defaults", () => {
    expect(invoke(["trips"]).name).toBe("trips list");
    expect(invoke(["trips"]).input).toMatchObject({ limit: 10, business: false });
    expect(invoke(["whoami"]).name).toBe("auth status");
  });

  test("positionals and variadic input", () => {
    expect(invoke(["trips", "get", "3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f"]).input).toMatchObject({ uuid: "3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f" });
    expect(invoke(["places", "search", "El", "Dorado", "--pickup"]).input).toMatchObject({ query: "El Dorado", pickup: true });
  });

  test("global flags are not command input", () => {
    const parsed = invoke(["me", "--json", "--profile", "work"]);
    expect(parsed.flags).toMatchObject({ json: true, profile: "work" });
    expect(parsed.input).toEqual({});
  });

  test("rejects unknown flags, stray arguments and bad values", () => {
    expect(failure(["trips", "list", "--limt", "3"])).toBe("usage");
    expect(failure(["me", "extra"])).toBe("usage");
    expect(failure(["trips", "get", "not-a-uuid"])).toBe("usage");
    expect(failure(["login", "--code", "12ab"])).toBe("usage");
  });
});

describe("registry", () => {
  test("names are unique and every input exports as JSON Schema", () => {
    const names = COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
    expect(new Set(names).size).toBe(names.length);
    for (const command of COMMANDS) expect(() => z.toJSONSchema(z.object(command.input))).not.toThrow();
  });

  test("money commands explain the confirm protocol", () => {
    for (const command of COMMANDS.filter((candidate) => candidate.risk === "money")) {
      expect(command.guidance).toContain("confirm");
      expect(Object.keys(command.input)).toContain("confirm");
    }
  });

  test("version matches package.json", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
