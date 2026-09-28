import type { UberError } from "../app/errors.js";
import { CONTRACT_VERSION, type Envelope, type NextStep } from "../contract.js";
import { style } from "./style.js";

export type Mode = "json" | "human";

export const forcedHuman = (): boolean => process.env.UBER_OUTPUT === "human";

export const detectMode = (json: boolean): Mode => {
  if (json || process.env.UBER_OUTPUT === "json") return "json";
  return forcedHuman() || process.stdout.isTTY ? "human" : "json";
};

const envelope = <T>(command: string, profile: string, fields: Partial<Envelope<T>>): Envelope<T> => ({
  version: CONTRACT_VERSION,
  command,
  timestamp: new Date().toISOString(),
  ok: fields.ok ?? true,
  profile,
  ...fields,
});

function printNext(next: NextStep[]): void {
  if (next.length === 0) return;
  process.stderr.write("\n");
  for (const step of next) {
    process.stderr.write(`${style.dim("next")}  ${step.command}\n      ${style.muted(step.reason)}\n`);
  }
}

export async function emitSuccess<T>(
  mode: Mode,
  command: string,
  profile: string,
  result: T,
  next: NextStep[],
  render?: (value: T) => string | Promise<string>,
): Promise<void> {
  if (mode === "json") {
    const body = envelope(command, profile, { ok: true, result, ...(next.length > 0 ? { nextSteps: next } : {}) });
    process.stdout.write(`${JSON.stringify(body)}\n`);
    return;
  }
  process.stdout.write(`${render ? await render(result) : JSON.stringify(result, null, 2)}\n`);
  printNext(next);
}

export function emitFailure(mode: Mode, command: string, profile: string, error: UberError): void {
  if (mode === "json") {
    const body = envelope<never>(command, profile, {
      ok: false,
      error: { code: error.code, message: error.message, ...(error.hint ? { hint: error.hint } : {}), retryable: error.retryable },
    });
    process.stdout.write(`${JSON.stringify(body)}\n`);
    return;
  }
  process.stderr.write(`${style.red("error")}  ${error.message}\n`);
  if (error.hint) process.stderr.write(`${style.yellow("hint")}   ${error.hint}\n`);
}

export const progressWriter = (mode: Mode) => (message: string) => {
  if (mode === "human") process.stderr.write(`${style.dim(`· ${message}`)}\n`);
};
