import type { VectorTile, VectorTileFeature } from "@mapbox/vector-tile";
import { BrailleCanvas, type Ink, type Rgb } from "./canvas.js";
import { boundsOf, type LatLng, type Point, project } from "./geo.js";
import { ATTRIBUTION, loadTiles, type TileId, tileZoom } from "./tiles.js";

export type Marker = { at: LatLng; glyph: string; color: Rgb; label?: string };

export type Scene = {
  route?: LatLng[];
  routeStyle?: "solid" | "dashed";
  markers: Marker[];
  vehicles?: LatLng[];
};

export type MapOptions = { cols: number; rows: number; color: boolean };

export const PALETTE = {
  water: [52, 88, 128],
  park: [40, 70, 48],
  road: { major: [150, 150, 150], medium: [96, 96, 96], minor: [58, 58, 58] },
  route: [45, 186, 228],
  pickup: [6, 193, 103],
  dropoff: [238, 64, 64],
  vehicle: [255, 190, 40],
  driver: [255, 255, 255],
  frame: [70, 70, 70],
  label: [235, 235, 235],
  street: [120, 132, 150],
} as const satisfies Record<string, Rgb | Record<string, Rgb>>;

const ink = (color: Rgb, layer: number): Ink => ({ color, layer });

const ROAD_TIER: Record<string, keyof typeof PALETTE.road> = {
  motorway: "major",
  trunk: "major",
  primary: "major",
  secondary: "medium",
  tertiary: "medium",
  minor: "minor",
  service: "minor",
};

type Frame = { zoom: number; origin: Point; canvas: BrailleCanvas };

function frameFor(points: LatLng[], options: MapOptions): Frame {
  const bounds = boundsOf(points);
  const canvas = new BrailleCanvas(options.cols, options.rows);
  const northWest = project({ latitude: bounds.north, longitude: bounds.west }, 0);
  const southEast = project({ latitude: bounds.south, longitude: bounds.east }, 0);
  const zoom = Math.min(
    17,
    Math.log2(Math.min(canvas.width / (southEast.x - northWest.x), canvas.height / (southEast.y - northWest.y))),
  );
  const center = project({ latitude: (bounds.north + bounds.south) / 2, longitude: (bounds.east + bounds.west) / 2 }, zoom);
  return { zoom, canvas, origin: { x: center.x - canvas.width / 2, y: center.y - canvas.height / 2 } };
}

const toCanvas = (frame: Frame, point: LatLng): Point => {
  const world = project(point, frame.zoom);
  return { x: world.x - frame.origin.x, y: world.y - frame.origin.y };
};

function coveringTiles(frame: Frame): TileId[] {
  const z = tileZoom(frame.zoom);
  const scale = 2 ** (frame.zoom - z) * 256;
  const minX = Math.floor(frame.origin.x / scale);
  const minY = Math.floor(frame.origin.y / scale);
  const maxX = Math.floor((frame.origin.x + frame.canvas.width) / scale);
  const maxY = Math.floor((frame.origin.y + frame.canvas.height) / scale);
  const ids: TileId[] = [];
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) ids.push({ z, x, y });
  return ids.length <= 16 ? ids : [];
}

function drawFeature(frame: Frame, tile: TileId, feature: VectorTileFeature, style: Ink): void {
  const scale = (2 ** (frame.zoom - tile.z) * 256) / feature.extent;
  const offsetX = tile.x * 2 ** (frame.zoom - tile.z) * 256 - frame.origin.x;
  const offsetY = tile.y * 2 ** (frame.zoom - tile.z) * 256 - frame.origin.y;
  for (const ring of feature.loadGeometry()) {
    frame.canvas.path(
      ring.map((point) => ({ x: offsetX + point.x * scale, y: offsetY + point.y * scale })),
      style,
    );
  }
}

function metersPerDot(frame: Frame): number {
  const latitude = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (frame.origin.y + frame.canvas.height / 2)) / (256 * 2 ** frame.zoom)))) * 180) / Math.PI;
  return (156_543.03 * Math.cos((latitude * Math.PI) / 180)) / 2 ** frame.zoom;
}

function visibleTiers(frame: Frame): Set<keyof typeof PALETTE.road> {
  const scale = metersPerDot(frame);
  if (scale < 6) return new Set(["major", "medium", "minor"]);
  if (scale < 40) return new Set(["major", "medium"]);
  return new Set(["major"]);
}

function drawBasemap(frame: Frame, tiles: Map<string, VectorTile>, ids: TileId[]): void {
  const tiers = visibleTiers(frame);
  for (const id of ids) {
    const tile = tiles.get(`${id.z}/${id.x}/${id.y}`);
    if (!tile) continue;
    const water = tile.layers.water;
    for (let index = 0; water && index < water.length; index++) drawFeature(frame, id, water.feature(index), ink(PALETTE.water, 1));
    const park = tile.layers.park;
    for (let index = 0; park && index < park.length; index++) drawFeature(frame, id, park.feature(index), ink(PALETTE.park, 1));
    const roads = tile.layers.transportation;
    for (let index = 0; roads && index < roads.length; index++) {
      const feature = roads.feature(index);
      const tier = ROAD_TIER[String(feature.properties.class)];
      if (feature.type !== 2 || !tier || !tiers.has(tier)) continue;
      drawFeature(frame, id, feature, ink(PALETTE.road[tier], tier === "major" ? 4 : tier === "medium" ? 3 : 2));
    }
  }
}

const STREET_CLASSES = new Set(["motorway", "trunk", "primary", "secondary"]);
const MAX_STREET_LABELS = 7;

function drawStreetNames(frame: Frame, tiles: Map<string, VectorTile>, ids: TileId[]): void {
  const candidates = new Map<string, Point[]>();
  for (const id of ids) {
    const names = tiles.get(`${id.z}/${id.x}/${id.y}`)?.layers.transportation_name;
    for (let index = 0; names && index < names.length; index++) {
      const feature = names.feature(index);
      const name = String(feature.properties.name ?? "");
      if (!name || name.length > 22 || !STREET_CLASSES.has(String(feature.properties.class))) continue;
      const scale = (2 ** (frame.zoom - id.z) * 256) / feature.extent;
      const offsetX = id.x * 2 ** (frame.zoom - id.z) * 256 - frame.origin.x;
      const offsetY = id.y * 2 ** (frame.zoom - id.z) * 256 - frame.origin.y;
      const points = feature
        .loadGeometry()
        .flat()
        .map((point) => ({ x: offsetX + point.x * scale, y: offsetY + point.y * scale }))
        .filter((point) => point.x >= 0 && point.y >= 0 && point.x < frame.canvas.width && point.y < frame.canvas.height);
      candidates.set(name, [...(candidates.get(name) ?? []), ...points]);
    }
  }
  const ranked = [...candidates.entries()].sort((a, b) => b[1].length - a[1].length);
  let placed = 0;
  for (const [name, points] of ranked) {
    if (placed >= MAX_STREET_LABELS) return;
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const middle = sorted[Math.floor(sorted.length / 2)];
    const spot = [middle, ...sorted].find((point) => point && frame.canvas.isFree({ x: point.x - name.length, y: point.y }, name.length));
    if (!spot) continue;
    frame.canvas.text({ x: spot.x - name.length, y: spot.y }, name, ink(PALETTE.street, 6));
    placed++;
  }
}

function drawMarkers(frame: Frame, scene: Scene): void {
  for (const vehicle of scene.vehicles ?? []) frame.canvas.glyph(toCanvas(frame, vehicle), "•", ink(PALETTE.vehicle, 8));
  for (const marker of scene.markers) {
    const at = toCanvas(frame, marker.at);
    frame.canvas.glyph(at, marker.glyph, ink(marker.color, 10));
    if (!marker.label) continue;
    const label = marker.label.length > 28 ? `${marker.label.slice(0, 27)}…` : marker.label;
    const rightRoom = frame.canvas.cols - Math.floor(at.x / 2) - 2;
    const x = rightRoom >= label.length ? at.x + 4 : at.x - (label.length + 1) * 2;
    frame.canvas.text({ x, y: at.y }, label, ink(PALETTE.label, 9));
  }
}

function border(lines: string[], cols: number, color: boolean, caption: string): string[] {
  const paint = (text: string) => (color ? `\u001b[38;2;${PALETTE.frame.join(";")}m${text}\u001b[0m` : text);
  const tail = caption.length + 4 <= cols ? caption : "";
  return [
    paint(`╭${"─".repeat(cols)}╮`),
    ...lines.map((line) => `${paint("│")}${line}${" ".repeat(Math.max(0, cols - visible(line)))}${paint("│")}`),
    paint(`╰${"─".repeat(Math.max(0, cols - tail.length - 2))}${tail ? ` ${tail} ` : ""}╯`),
  ];
}

const visible = (text: string): number => [...text.replace(/\u001b\[[0-9;]*m/g, "")].length;

export async function renderMap(scene: Scene, options: MapOptions): Promise<string> {
  const points = [...(scene.route ?? []), ...scene.markers.map((marker) => marker.at), ...(scene.vehicles ?? [])];
  if (points.length === 0) return "";
  const frame = frameFor(points, options);
  const ids = coveringTiles(frame);
  const tiles = await loadTiles(ids);
  drawBasemap(frame, tiles, ids);
  if (scene.route && scene.route.length > 1) {
    frame.canvas.path(
      scene.route.map((point) => toCanvas(frame, point)),
      ink(PALETTE.route, 7),
      { dashed: scene.routeStyle === "dashed", bold: scene.routeStyle !== "dashed" },
    );
  }
  drawMarkers(frame, scene);
  drawStreetNames(frame, tiles, ids);
  return border(frame.canvas.render(options.color), options.cols, options.color, ATTRIBUTION).join("\n");
}

export function mapSize(): { cols: number; rows: number } {
  const columns = process.stdout.columns || 80;
  const cols = Math.max(40, Math.min(columns - 2, 76));
  return { cols, rows: Math.round(cols / 3.2) };
}
