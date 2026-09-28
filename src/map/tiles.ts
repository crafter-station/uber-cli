import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { VERSION } from "../version.js";

const TILEJSON = "https://tiles.openfreemap.org/planet";
const MAX_ZOOM = 14;
const TILEJSON_TTL_MS = 24 * 3_600_000;
const USER_AGENT = `uber-cli/${VERSION} (+https://github.com/crafter-station/uber-cli)`;

export const ATTRIBUTION = "OpenFreeMap © OpenMapTiles Data from OpenStreetMap";

export type TileId = { z: number; x: number; y: number };

function cacheRoot(): string {
  const override = process.env.UBER_CACHE?.trim();
  if (override) return override;
  if (platform() === "darwin") return join(homedir(), "Library", "Caches", "uber");
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "uber");
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(8_000) });
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

function write(path: string, bytes: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

async function template(): Promise<string | null> {
  const file = join(cacheRoot(), "tiles", "tilejson.json");
  if (existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, "utf8")) as { at: number; url: string };
    if (Date.now() - cached.at < TILEJSON_TTL_MS) return cached.url;
  }
  const bytes = await fetchBytes(TILEJSON);
  if (!bytes) return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { url: string }).url : null;
  const url = (JSON.parse(new TextDecoder().decode(bytes)) as { tiles?: string[] }).tiles?.[0] ?? null;
  if (url) write(file, JSON.stringify({ at: Date.now(), url }));
  return url;
}

export const tileZoom = (zoom: number): number => Math.max(0, Math.min(MAX_ZOOM, Math.floor(zoom)));

export async function loadTiles(ids: TileId[]): Promise<Map<string, VectorTile>> {
  const url = await template();
  const tiles = new Map<string, VectorTile>();
  if (!url) return tiles;
  const version = url.split("/").at(-4) ?? "current";
  await Promise.all(
    ids.map(async ({ z, x, y }) => {
      const file = join(cacheRoot(), "tiles", version, String(z), String(x), `${y}.pbf`);
      let bytes: Uint8Array | null = existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
      if (!bytes) {
        bytes = await fetchBytes(url.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)));
        if (bytes) write(file, bytes);
      }
      if (bytes) tiles.set(`${z}/${x}/${y}`, new VectorTile(new PbfReader(bytes)));
    }),
  );
  return tiles;
}
