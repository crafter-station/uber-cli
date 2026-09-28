import type { z } from "zod";
import type { NextStep } from "../contract.js";
import type { UberClient } from "../uber/client.js";

export type Risk = "read" | "auth" | "money" | "local";

export type Context = {
  profile: string;
  interactive: boolean;
  headed: boolean;
  client(): UberClient;
  progress(message: string): void;
};

export type Outcome<T> = { result: T; next?: NextStep[] };

export type Command<S extends z.ZodRawShape = z.ZodRawShape, T = unknown> = {
  name: string;
  summary: string;
  guidance?: string;
  risk: Risk;
  input: S;
  positionals?: (keyof S & string)[];
  variadic?: keyof S & string;
  aliases?: string[];
  examples: string[];
  mcp?: boolean;
  run(input: z.infer<z.ZodObject<S>>, context: Context): Promise<Outcome<T>>;
  render?(result: T): string | Promise<string>;
};

export const defineCommand = <S extends z.ZodRawShape, T>(command: Command<S, T>): Command<S, T> => command;

export const step = (command: string, reason: string): NextStep => ({ command, reason });

export const withProfile = (command: string, profile: string): string =>
  profile === "default" ? command : `${command} --profile ${profile}`;
