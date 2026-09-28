import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { absorbSetCookies, type Cookie, cookieHeader, domainMatches, mergeCookies } from "./jar.js";
import type { Keychain } from "./keychain.js";
import { forgetSession, loadSession, resolveKey, saveSession } from "./vault.js";

const cookie = (fields: Partial<Cookie> & Pick<Cookie, "name" | "domain">): Cookie => ({
  value: "v",
  path: "/",
  expires: -1,
  ...fields,
});

describe("cookie jar", () => {
  test("domain matching follows browser rules", () => {
    expect(domainMatches(".uber.com", "riders.uber.com")).toBe(true);
    expect(domainMatches(".uber.com", "uber.com")).toBe(true);
    expect(domainMatches(".uber.com", "eviluber.com")).toBe(false);
    expect(domainMatches("riders.uber.com", "m.uber.com")).toBe(false);
  });

  test("header picks host, path and liveness", () => {
    const cookies = [
      cookie({ name: "sid", domain: ".uber.com", value: "shared" }),
      cookie({ name: "jwt", domain: "riders.uber.com", value: "riders" }),
      cookie({ name: "jwt", domain: "m.uber.com", value: "rides" }),
      cookie({ name: "old", domain: ".uber.com", expires: 1 }),
      cookie({ name: "deep", domain: ".uber.com", path: "/go" }),
    ];
    expect(cookieHeader(cookies, new URL("https://riders.uber.com/graphql"))).toBe("sid=shared; jwt=riders");
    expect(cookieHeader(cookies, new URL("https://m.uber.com/go/graphql"))).toBe("sid=shared; jwt=rides; deep=v");
  });

  test("set-cookie updates, adds and deletes", () => {
    const base = [cookie({ name: "jwt", domain: "riders.uber.com", value: "a" }), cookie({ name: "gone", domain: "riders.uber.com" })];
    const next = absorbSetCookies(base, ["jwt=b; Path=/; HttpOnly", "gone=; Max-Age=0", "fresh=1; Domain=uber.com"], "riders.uber.com");
    expect(next.find((c) => c.name === "jwt")?.value).toBe("b");
    expect(next.some((c) => c.name === "gone")).toBe(false);
    expect(next.find((c) => c.name === "fresh")?.domain).toBe(".uber.com");
  });

  test("merge keys by domain, path and name", () => {
    const merged = mergeCookies([cookie({ name: "a", domain: ".uber.com" })], [cookie({ name: "a", domain: ".ubereats.com" })]);
    expect(merged).toHaveLength(2);
  });
});

describe("vault", () => {
  let home: string;
  const store = new Map<string, string>();
  const fakeKeychain: Keychain = {
    available: () => true,
    read: (account) => store.get(account) ?? null,
    write: (account, value) => (store.set(account, value), true),
    remove: (account) => store.delete(account),
  };

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "uber-test-"));
    process.env.UBER_HOME = home;
  });

  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
    delete process.env.UBER_HOME;
  });

  test("seals the session with a keychain key and a 0600 file", () => {
    const session = { version: 1 as const, savedAt: new Date().toISOString(), cookies: [cookie({ name: "sid", domain: ".uber.com", value: "secret-value" })] };
    expect(saveSession("work", session, fakeKeychain)).toBe("keychain");
    const file = join(home, "profiles", "work", "session.enc");
    expect(readFileSync(file, "utf8")).not.toContain("secret-value");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "profiles", "work")).mode & 0o777).toBe(0o700);
    expect(loadSession("work", fakeKeychain)?.cookies[0]?.value).toBe("secret-value");
  });

  test("a wrong key cannot open the session", () => {
    store.set("work/key", "0".repeat(64));
    expect(loadSession("work", fakeKeychain)).toBeNull();
  });

  test("forget removes the file and the key", () => {
    forgetSession("work", fakeKeychain);
    expect(loadSession("work", fakeKeychain)).toBeNull();
    expect(resolveKey("work", fakeKeychain)).toBeNull();
  });
});
