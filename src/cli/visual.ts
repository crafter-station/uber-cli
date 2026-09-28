import { UberError } from "../app/errors.js";
import { decodePolyline, type LatLng } from "../map/geo.js";
import { graphicsProtocol, inlineImage } from "../map/image.js";
import { type Marker, mapSize, PALETTE, renderMap, type Scene } from "../map/render.js";
import { LOGO_TEXT, LOGO_PNG_BASE64 } from "../ui/logo.generated.js";
import { forcedHuman } from "./output.js";
import { style } from "./style.js";

export type VisualMode = "auto" | "image" | "braille" | "off";

const MODES = new Set<VisualMode>(["auto", "image", "braille", "off"]);

let mode: VisualMode = "auto";

export function setVisualMode(value: unknown): void {
  const chosen = typeof value === "string" ? value : process.env.UBER_MAP?.trim() || "auto";
  if (!MODES.has(chosen as VisualMode)) {
    throw new UberError("usage", `--map must be auto, image, braille or off (got "${chosen}").`);
  }
  mode = chosen as VisualMode;
}

const colorful = (): boolean => !process.env.NO_COLOR;

const imageProtocol = () => (mode === "auto" || mode === "image" ? graphicsProtocol() : null);

export async function mapView(scene: Scene, image?: () => Promise<Uint8Array | null>): Promise<string | null> {
  if (mode === "off" || !(process.stdout.isTTY || forcedHuman())) return null;
  const protocol = imageProtocol();
  if (protocol && image) {
    const bytes = await image().catch(() => null);
    if (bytes) return inlineImage(bytes, { cols: mapSize().cols, protocol });
  }
  try {
    const drawn = await renderMap(scene, { ...mapSize(), color: colorful() });
    return drawn || null;
  } catch {
    return null;
  }
}

export function banner(): string {
  const protocol = imageProtocol();
  if (protocol && process.stdout.isTTY) {
    return inlineImage(Buffer.from(LOGO_PNG_BASE64, "base64"), { cols: 14, protocol });
  }
  return LOGO_TEXT.map((line) => style.bold(line.replace(/⠀/g, " "))).join("\n");
}

export const pickupMarker = (at: LatLng, label?: string): Marker => ({ at, glyph: "●", color: PALETTE.pickup, label });

export const dropoffMarker = (at: LatLng, label?: string): Marker => ({ at, glyph: "●", color: PALETTE.dropoff, label });

export const driverMarker = (at: LatLng, label?: string): Marker => ({ at, glyph: "▲", color: PALETTE.driver, label });

export const decodeRoute = (polyline: string | null | undefined): LatLng[] | undefined =>
  polyline ? decodePolyline(polyline) : undefined;

export async function fetchImage(url: string | null | undefined): Promise<Uint8Array | null> {
  if (!url) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
}

export const isRealLocation = (point: LatLng | null | undefined): point is LatLng =>
  !!point && (Math.abs(point.latitude) > 0.0001 || Math.abs(point.longitude) > 0.0001);
