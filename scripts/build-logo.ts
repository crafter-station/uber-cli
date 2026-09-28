import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const source = readFileSync(join(root, "assets", "uber-wordmark.svg"), "utf8");
const work = mkdtempSync(join(tmpdir(), "uber-logo-"));

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout;
}

try {
  const white = join(work, "white.svg");
  writeFileSync(white, source.replace(/<svg /, '<svg fill="#FFFFFF" ').replace(/fill="#[0-9A-Fa-f]{3,6}"/g, 'fill="#FFFFFF"'));
  const png = join(work, "white.png");
  run("rsvg-convert", ["-w", "480", white, "-o", png]);
  const text = run("chafa", ["-f", "symbols", "--symbols=block+border+space", "--size", "32x6", "-c", "none", "--fg-only", png])
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const image = readFileSync(png).toString("base64");
  writeFileSync(
    join(root, "src", "ui", "logo.generated.ts"),
    `export const LOGO_TEXT = ${JSON.stringify(text, null, 2)};\n\nexport const LOGO_PNG_BASE64 =\n  ${JSON.stringify(image)};\n`,
  );
  console.log(`logo: ${text.length} text rows, ${Math.round((image.length * 3) / 4 / 1024)} KB png`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
