export const CONTRACT_VERSION = "1";

export type NextStep = { command: string; reason: string };

export type EnvelopeError = {
  code: string;
  message: string;
  hint?: string;
  retryable: boolean;
};

export type Envelope<T = unknown> = {
  version: string;
  command: string;
  timestamp: string;
  ok: boolean;
  profile: string;
  result?: T;
  error?: EnvelopeError;
  nextSteps?: NextStep[];
};

export const EXIT = {
  ok: 0,
  runtime: 1,
  usage: 2,
  auth: 3,
  notFound: 4,
  network: 5,
  blocked: 6,
  pending: 8,
  upstream: 9,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
