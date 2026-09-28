import { EXIT, type ExitCode } from "../contract.js";

export type ErrorCode =
  | "usage"
  | "auth.missing"
  | "auth.expired"
  | "auth.challenge"
  | "not-found"
  | "network"
  | "upstream"
  | "blocked.killswitch"
  | "blocked.confirm"
  | "blocked.max-fare"
  | "browser.missing"
  | "browser.failed"
  | "runtime";

const EXIT_BY_CODE: Record<ErrorCode, ExitCode> = {
  usage: EXIT.usage,
  "auth.missing": EXIT.auth,
  "auth.expired": EXIT.auth,
  "auth.challenge": EXIT.auth,
  "not-found": EXIT.notFound,
  network: EXIT.network,
  upstream: EXIT.upstream,
  "blocked.killswitch": EXIT.blocked,
  "blocked.confirm": EXIT.blocked,
  "blocked.max-fare": EXIT.blocked,
  "browser.missing": EXIT.runtime,
  "browser.failed": EXIT.runtime,
  runtime: EXIT.runtime,
};

const RETRYABLE = new Set<ErrorCode>(["network", "upstream"]);

export class UberError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "UberError";
    this.code = code;
    this.hint = hint;
  }

  get exitCode(): ExitCode {
    return EXIT_BY_CODE[this.code];
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}

export function asUberError(error: unknown): UberError {
  if (error instanceof UberError) return error;
  if (error instanceof TypeError && /fetch failed|ENOTFOUND|ECONNRESET/i.test(String(error.cause ?? error))) {
    return new UberError("network", "Could not reach Uber.", "Check the connection and retry.");
  }
  return new UberError("runtime", error instanceof Error ? error.message : String(error));
}
