import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UberError } from "./errors.js";
import { assertWritesAllowed, audit, createPending, readAudit, setKillswitch, takePending } from "./safety.js";

let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "uber-safety-"));
  process.env.UBER_HOME = home;
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.UBER_HOME;
});

const soon = () => new Date(Date.now() + 60_000);

const code = (run: () => unknown): string | null => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof UberError ? error.code : "other";
  }
};

describe("confirm tokens", () => {
  test("are single use", () => {
    const pending = createPending("rq", "rides.request", "default", {}, { fare: 1 }, soon());
    expect(pending.token).toMatch(/^rq_[a-z0-9]{12}$/);
    expect(takePending<{ fare: number }>(pending.token, "rides.request", "default").payload.fare).toBe(1);
    expect(code(() => takePending(pending.token, "rides.request", "default"))).toBe("blocked.confirm");
  });

  test("are bound to their action and profile", () => {
    const pending = createPending("rq", "rides.request", "default", {}, {}, soon());
    expect(code(() => takePending(pending.token, "rides.cancel", "default"))).toBe("blocked.confirm");
    const other = createPending("rq", "rides.request", "default", {}, {}, soon());
    expect(code(() => takePending(other.token, "rides.request", "work"))).toBe("blocked.confirm");
  });

  test("reject anything that is not a token", () => {
    expect(code(() => takePending("../../etc/passwd", "rides.request", "default"))).toBe("blocked.confirm");
  });
});

describe("killswitch", () => {
  test("revokes every pending confirmation when switched on", () => {
    const first = createPending("rq", "rides.request", "default", {}, {}, soon());
    const second = createPending("rc", "rides.cancel", "default", {}, {}, soon());
    expect(setKillswitch(true, "demo").tokensRevoked).toBeGreaterThanOrEqual(2);
    setKillswitch(false);
    expect(code(() => takePending(first.token, "rides.request", "default"))).toBe("blocked.confirm");
    expect(code(() => takePending(second.token, "rides.cancel", "default"))).toBe("blocked.confirm");
  });

  test("burns a token that hits the freeze, so unfreezing never revives it", () => {
    setKillswitch(true);
    const pending = createPending("rq", "rides.request", "default", {}, {}, soon());
    expect(code(() => assertWritesAllowed(pending.token))).toBe("blocked.killswitch");
    setKillswitch(false);
    expect(code(() => assertWritesAllowed(pending.token))).toBeNull();
    expect(code(() => takePending(pending.token, "rides.request", "default"))).toBe("blocked.confirm");
  });
});

describe("audit", () => {
  test("appends and reads back in order", () => {
    audit({ action: "rides.request", profile: "default", outcome: "started" });
    audit({ action: "rides.request", profile: "default", outcome: "succeeded" });
    expect(readAudit(2).map((entry) => entry.outcome)).toEqual(["started", "succeeded"]);
  });
});
