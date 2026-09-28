import type { Point } from "./geo.js";

export type Rgb = readonly [number, number, number];

export type Ink = { color: Rgb; layer: number };

const DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

type Cell = { bits: number; ink: Ink | null; glyph: { char: string; ink: Ink } | null };

export class BrailleCanvas {
  readonly width: number;
  readonly height: number;
  private readonly cells: Cell[];

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.width = cols * 2;
    this.height = rows * 4;
    this.cells = Array.from({ length: cols * rows }, () => ({ bits: 0, ink: null, glyph: null }));
  }

  private cell(x: number, y: number): Cell | null {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.cells[Math.floor(y / 4) * this.cols + Math.floor(x / 2)] ?? null;
  }

  dot(x: number, y: number, ink: Ink): void {
    const px = Math.round(x);
    const py = Math.round(y);
    const cell = this.cell(px, py);
    if (!cell) return;
    cell.bits |= DOTS[py % 4]?.[px % 2] ?? 0;
    if (!cell.ink || ink.layer >= cell.ink.layer) cell.ink = ink;
  }

  line(from: Point, to: Point, ink: Ink, dashed = false): void {
    let x0 = Math.round(from.x);
    let y0 = Math.round(from.y);
    const x1 = Math.round(to.x);
    const y1 = Math.round(to.y);
    if (Math.max(Math.abs(x0), Math.abs(y0), Math.abs(x1), Math.abs(y1)) > 1e5) return;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    let step = 0;
    for (;;) {
      if (!dashed || step++ % 4 < 2) this.dot(x0, y0, ink);
      if (x0 === x1 && y0 === y1) return;
      const doubled = 2 * error;
      if (doubled >= dy) {
        error += dy;
        x0 += sx;
      }
      if (doubled <= dx) {
        error += dx;
        y0 += sy;
      }
    }
  }

  path(points: Point[], ink: Ink, options: { dashed?: boolean; bold?: boolean } = {}): void {
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1] as Point;
      const to = points[index] as Point;
      this.line(from, to, ink, options.dashed);
      if (options.bold) {
        this.line({ x: from.x + 1, y: from.y }, { x: to.x + 1, y: to.y }, ink, options.dashed);
        this.line({ x: from.x, y: from.y + 1 }, { x: to.x, y: to.y + 1 }, ink, options.dashed);
      }
    }
  }

  glyph(point: Point, char: string, ink: Ink): void {
    const cell = this.cell(Math.round(point.x), Math.round(point.y));
    if (cell && (!cell.glyph || ink.layer >= cell.glyph.ink.layer)) cell.glyph = { char, ink };
  }

  text(point: Point, label: string, ink: Ink): void {
    const col = Math.floor(Math.round(point.x) / 2);
    const row = Math.floor(Math.round(point.y) / 4);
    const start = Math.max(0, Math.min(col, this.cols - label.length));
    [...label].forEach((char, offset) => this.glyph({ x: (start + offset) * 2, y: row * 4 }, char, ink));
  }

  isFree(point: Point, length: number, padding = 1): boolean {
    const col = Math.floor(Math.round(point.x) / 2);
    const row = Math.floor(Math.round(point.y) / 4);
    if (row < 0 || row >= this.rows || col - padding < 0 || col + length + padding > this.cols) return false;
    for (let r = Math.max(0, row - 1); r <= Math.min(this.rows - 1, row + 1); r++) {
      for (let c = col - padding; c < col + length + padding; c++) {
        if (this.cells[r * this.cols + c]?.glyph) return false;
      }
    }
    return true;
  }

  render(color: boolean): string[] {
    const lines: string[] = [];
    for (let row = 0; row < this.rows; row++) {
      let line = "";
      let current = "";
      for (let col = 0; col < this.cols; col++) {
        const cell = this.cells[row * this.cols + col] as Cell;
        const char = cell.glyph?.char ?? (cell.bits ? String.fromCharCode(0x2800 + cell.bits) : " ");
        const ink = cell.glyph?.ink ?? cell.ink;
        if (color && ink && char !== " ") {
          const code = `\u001b[38;2;${ink.color[0]};${ink.color[1]};${ink.color[2]}m`;
          if (code !== current) {
            line += code;
            current = code;
          }
        }
        line += char;
      }
      lines.push(color && current ? `${line}\u001b[0m` : line.trimEnd());
    }
    return lines;
  }
}
