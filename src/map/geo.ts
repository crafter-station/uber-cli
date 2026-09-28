export type LatLng = { latitude: number; longitude: number };

export type Point = { x: number; y: number };

export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    latitude += next();
    longitude += next();
    points.push({ latitude: latitude / factor, longitude: longitude / factor });
  }
  return points;
}

const TILE = 256;

export function project(point: LatLng, zoom: number): Point {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin((Math.max(-85.05, Math.min(85.05, point.latitude)) * Math.PI) / 180);
  return {
    x: ((point.longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export type Bounds = { south: number; west: number; north: number; east: number };

export function boundsOf(points: LatLng[], padding = 0.18, minSpan = 0.004): Bounds {
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  let south = Math.min(...latitudes);
  let north = Math.max(...latitudes);
  let west = Math.min(...longitudes);
  let east = Math.max(...longitudes);
  const latSpan = Math.max(north - south, minSpan);
  const lngSpan = Math.max(east - west, minSpan);
  const latMid = (north + south) / 2;
  const lngMid = (east + west) / 2;
  south = latMid - (latSpan / 2) * (1 + padding * 2);
  north = latMid + (latSpan / 2) * (1 + padding * 2);
  west = lngMid - (lngSpan / 2) * (1 + padding * 2);
  east = lngMid + (lngSpan / 2) * (1 + padding * 2);
  return { south, west, north, east };
}

export function distanceKm(a: LatLng, b: LatLng): number {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians;
  const dLng = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
