import { spawnSync } from "node:child_process";
import { platform } from "node:os";

const SERVICE = "uber-cli";

export type Keychain = {
  available(): boolean;
  read(account: string): string | null;
  write(account: string, value: string): boolean;
  remove(account: string): boolean;
};

const onMac = (): boolean => platform() === "darwin";

export const macKeychain: Keychain = {
  available: onMac,

  read(account) {
    if (!onMac()) return null;
    const result = spawnSync("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"], {
      encoding: "utf8",
    });
    return result.status === 0 ? result.stdout.trim() || null : null;
  },

  write(account, value) {
    if (!onMac() || !/^[A-Za-z0-9+/=_-]+$/.test(value)) return false;
    const command = `add-generic-password -U -s ${SERVICE} -a ${account} -w ${value}\n`;
    const result = spawnSync("security", ["-i"], { input: command, encoding: "utf8" });
    return result.status === 0 && this.read(account) === value;
  },

  remove(account) {
    if (!onMac()) return false;
    return spawnSync("security", ["delete-generic-password", "-s", SERVICE, "-a", account]).status === 0;
  },
};
