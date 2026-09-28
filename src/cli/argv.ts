import { z } from "zod";
import { UberError } from "../app/errors.js";
import type { Command } from "../commands/define.js";

export type Flags = Record<string, string | true>;

export type Invocation = { command: Command | null; words: string[]; flags: Flags };

export const GLOBAL_BOOLEANS = new Set(["json", "help", "h", "version", "v", "headed"]);
export const GLOBAL_VALUES = new Set(["profile", "map"]);

const camel = (flag: string): string => flag.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
export const kebab = (key: string): string => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  while (current instanceof z.ZodOptional || current instanceof z.ZodDefault || current instanceof z.ZodNullable) {
    current = current.unwrap() as z.ZodType;
  }
  return current;
}

export const isBooleanField = (schema: z.ZodType): boolean => unwrap(schema) instanceof z.ZodBoolean;

function booleanFlags(commands: Command[]): Set<string> {
  const names = new Set(GLOBAL_BOOLEANS);
  for (const command of commands) {
    for (const [key, schema] of Object.entries(command.input)) if (isBooleanField(schema as z.ZodType)) names.add(key);
  }
  return names;
}

function tokenize(argv: string[], booleans: Set<string>): { words: string[]; flags: Flags } {
  const words: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? "";
    if (token === "--") {
      words.push(...argv.slice(index + 1));
      break;
    }
    if (token === "-h") {
      flags.help = true;
      continue;
    }
    if (!token.startsWith("--") || token.length === 2) {
      words.push(token);
      continue;
    }
    const [rawName = "", inline] = token.slice(2).split(/=(.*)/s, 2);
    const name = camel(rawName);
    if (inline !== undefined) flags[name] = inline;
    else if (booleans.has(name)) flags[name] = true;
    else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UberError("usage", `--${rawName} needs a value.`);
      }
      flags[name] = value;
      index++;
    }
  }
  return { words, flags };
}

function match(commands: Command[], words: string[]): { command: Command | null; rest: string[] } {
  let best: { command: Command; length: number } | null = null;
  for (const command of commands) {
    for (const name of [command.name, ...(command.aliases ?? [])]) {
      const parts = name.split(" ");
      const fits = parts.every((part, index) => words[index] === part);
      if (fits && parts.length > (best?.length ?? 0)) best = { command, length: parts.length };
    }
  }
  return best ? { command: best.command, rest: words.slice(best.length) } : { command: null, rest: words };
}

export function parseInvocation(argv: string[], commands: Command[]): Invocation {
  const { words, flags } = tokenize(argv, booleanFlags(commands));
  const { command, rest } = match(commands, words);
  return { command, words: command ? rest : words, flags };
}

export function buildInput(command: Command, words: string[], flags: Flags): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (GLOBAL_BOOLEANS.has(key) || GLOBAL_VALUES.has(key)) continue;
    if (!(key in command.input)) {
      throw new UberError("usage", `Unknown flag --${kebab(key)} for \`uber ${command.name}\`.`, `See \`uber ${command.name} --help\`.`);
    }
    const schema = command.input[key] as z.ZodType;
    input[key] = isBooleanField(schema) ? value === true || value === "true" : value;
  }
  if (command.variadic) {
    if (words.length > 0) input[command.variadic] = words.join(" ");
  } else {
    const positionals = command.positionals ?? [];
    if (words.length > positionals.length) {
      throw new UberError("usage", `Unexpected argument "${words[positionals.length]}".`, `See \`uber ${command.name} --help\`.`);
    }
    positionals.forEach((key, index) => {
      if (words[index] !== undefined) input[key] = words[index];
    });
  }
  const parsed = z.object(command.input).safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = String(issue?.path[0] ?? "");
    const where = key ? (command.positionals?.includes(key) || command.variadic === key ? `<${key}>` : `--${kebab(key)}`) : "input";
    throw new UberError("usage", `${where}: ${issue?.message ?? "invalid"}`, `See \`uber ${command.name} --help\`.`);
  }
  return parsed.data;
}
