import colors from "picocolors";

export const style = {
  bold: colors.bold,
  dim: colors.dim,
  green: colors.green,
  red: colors.red,
  yellow: colors.yellow,
  cyan: colors.cyan,
  muted: (text: string) => colors.gray(text),
};

export function table(rows: string[][], gap = 2): string {
  const widths = rows.reduce<number[]>(
    (acc, row) => row.map((cell, index) => Math.max(acc[index] ?? 0, visibleLength(cell))),
    [],
  );
  return rows
    .map((row) =>
      row
        .map((cell, index) => (index === row.length - 1 ? cell : cell + " ".repeat((widths[index] ?? 0) - visibleLength(cell) + gap)))
        .join("")
        .trimEnd(),
    )
    .join("\n");
}

const ANSI = /\u001b\[[0-9;]*m/g;

const visibleLength = (text: string): number => text.replace(ANSI, "").length;

export const field = (label: string, value: string | number | null | undefined): string | null =>
  value === null || value === undefined || value === "" ? null : `${style.muted(label.padEnd(12))}${value}`;

export const lines = (...parts: (string | null | undefined | false)[]): string =>
  parts.filter((part): part is string => typeof part === "string").join("\n");

export const clock = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
