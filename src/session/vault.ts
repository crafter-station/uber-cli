import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { profileDir } from "../app/paths.js";
import type { Cookie } from "./jar.js";
import { type Keychain, macKeychain } from "./keychain.js";

export type Account = {
  uuid: string;
  name: string;
  email?: string;
  phone?: string;
  rating?: string;
  country?: string;
};

export type Session = {
  version: 1;
  savedAt: string;
  account?: Account;
  cookies: Cookie[];
};

export type KeySource = "keychain" | "environment" | "key file";

type Sealed = { v: 1; iv: string; tag: string; data: string };

const HEX_KEY = /^[0-9a-f]{64}$/i;

const sessionFile = (profile: string): string => join(profileDir(profile), "session.enc");
const keyFile = (profile: string): string => join(profileDir(profile), "session.key");
const keychainAccount = (profile: string): string => `${profile}/key`;

function writePrivate(path: string, contents: string): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, contents, { mode: 0o600 });
  renameSync(temporary, path);
}

export function resolveKey(profile: string, keychain: Keychain = macKeychain): { key: Buffer; source: KeySource } | null {
  const fromEnv = process.env.UBER_SESSION_KEY?.trim();
  if (fromEnv && HEX_KEY.test(fromEnv)) return { key: Buffer.from(fromEnv, "hex"), source: "environment" };
  const fromKeychain = keychain.read(keychainAccount(profile));
  if (fromKeychain && HEX_KEY.test(fromKeychain)) return { key: Buffer.from(fromKeychain, "hex"), source: "keychain" };
  if (existsSync(keyFile(profile))) {
    const fromFile = readFileSync(keyFile(profile), "utf8").trim();
    if (HEX_KEY.test(fromFile)) return { key: Buffer.from(fromFile, "hex"), source: "key file" };
  }
  return null;
}

function ensureKey(profile: string, keychain: Keychain): { key: Buffer; source: KeySource } {
  const existing = resolveKey(profile, keychain);
  if (existing) return existing;
  const hex = randomBytes(32).toString("hex");
  if (keychain.available() && keychain.write(keychainAccount(profile), hex)) {
    return { key: Buffer.from(hex, "hex"), source: "keychain" };
  }
  writePrivate(keyFile(profile), hex);
  return { key: Buffer.from(hex, "hex"), source: "key file" };
}

function seal(plaintext: string, key: Buffer): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function open(sealed: Sealed, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8");
}

export function loadSession(profile: string, keychain: Keychain = macKeychain): Session | null {
  if (!existsSync(sessionFile(profile))) return null;
  const resolved = resolveKey(profile, keychain);
  if (!resolved) return null;
  try {
    const sealed = JSON.parse(readFileSync(sessionFile(profile), "utf8")) as Sealed;
    return JSON.parse(open(sealed, resolved.key)) as Session;
  } catch {
    return null;
  }
}

export function saveSession(profile: string, session: Session, keychain: Keychain = macKeychain): KeySource {
  const { key, source } = ensureKey(profile, keychain);
  writePrivate(sessionFile(profile), JSON.stringify(seal(JSON.stringify(session), key)));
  return source;
}

export function forgetSession(profile: string, keychain: Keychain = macKeychain): void {
  rmSync(sessionFile(profile), { force: true });
  rmSync(keyFile(profile), { force: true });
  keychain.remove(keychainAccount(profile));
}

export const hasSessionFile = (profile: string): boolean => existsSync(sessionFile(profile));
