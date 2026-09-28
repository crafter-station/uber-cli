import { UberError } from "../app/errors.js";
import { decodePolyline, type LatLng } from "../map/geo.js";
import type { UberClient } from "./client.js";

type RawActivity = { uuid: string; title: string; subtitle: string; description: string; cardURL: string };
type RawActivities = { activities: RawActivity[]; nextPageToken?: string | null };

export type TripSummary = { uuid: string; destination: string; when: string; fare: string; url: string };

export type TripList = { upcoming: TripSummary[]; past: TripSummary[]; nextCursor: string | null };

const summary = (activity: RawActivity): TripSummary => ({
  uuid: activity.uuid,
  destination: activity.title,
  when: activity.subtitle,
  fare: activity.description,
  url: activity.cardURL,
});

export async function listTrips(
  client: UberClient,
  options: { limit: number; cursor?: string; business?: boolean },
): Promise<TripList> {
  const { activities } = await client.graphql<{ activities: { past?: RawActivities; upcoming?: RawActivities } }>(
    "Activities",
    {
      includePast: true,
      includeUpcoming: !options.cursor,
      limit: options.limit,
      nextPageToken: options.cursor,
      orderTypes: ["RIDES", "TRAVEL"],
      profileType: options.business ? "BUSINESS" : "PERSONAL",
    },
  );
  return {
    upcoming: (activities.upcoming?.activities ?? []).map(summary),
    past: (activities.past?.activities ?? []).map(summary),
    nextCursor: activities.past?.nextPageToken || null,
  };
}

type RawTrip = {
  uuid: string;
  status: string;
  fare: string;
  driver: string;
  beginTripTime: string | null;
  dropoffTime: string | null;
  isSurgeTrip: boolean;
  isScheduledRide: boolean;
  marketplace: string;
  paymentProfileUUID: string;
  waypoints: string[];
};

export type Trip = {
  uuid: string;
  status: string;
  fare: string;
  driver: string | null;
  product: string | null;
  pickup: string | null;
  dropoff: string | null;
  stops: string[];
  startedAt: string | null;
  endedAt: string | null;
  distance: string | null;
  duration: string | null;
  surge: boolean;
  scheduled: boolean;
  paymentMethod: string;
  url: string;
  mapImageUrl: string | null;
  geometry: TripGeometry | null;
};

export type TripGeometry = { polyline: string | null; pickup: LatLng | null; dropoff: LatLng | null };

function coordinate(value: string | undefined): LatLng | null {
  const match = /(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(value ?? "");
  return match ? { latitude: Number(match[1]), longitude: Number(match[2]) } : null;
}

export function geometryFromMapUrl(mapUrl: string | null | undefined): TripGeometry | null {
  if (!mapUrl) return null;
  try {
    const url = new URL(mapUrl);
    const polyline = url.searchParams.getAll("path").map((path) => /enc:(.+)$/.exec(path)?.[1]).find(Boolean) ?? null;
    const [pickup = null, dropoff = null] = url.searchParams.getAll("markers").map((marker) => coordinate(marker.split("|").pop()));
    const route = polyline ? decodePolyline(polyline) : [];
    if (!pickup && route.length === 0) return null;
    return { polyline, pickup: pickup ?? route[0] ?? null, dropoff: dropoff ?? route.at(-1) ?? null };
  } catch {
    return null;
  }
}

const isoOrNull = (value: string | null): string | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
};

export async function getTrip(client: UberClient, uuid: string): Promise<Trip> {
  const { getTrip } = await client.graphql<{
    getTrip: { mapURL?: string | null; trip: RawTrip | null; receipt: { distance?: string; distanceLabel?: string; duration?: string; vehicleType?: string } | null };
  }>("GetTrip", { tripUUID: uuid });
  const trip = getTrip.trip;
  if (!trip) throw new UberError("not-found", `No trip ${uuid} on this account.`, "`uber trips` lists recent trips.");
  const receipt = getTrip.receipt;
  const waypoints = trip.waypoints ?? [];
  return {
    uuid: trip.uuid,
    status: trip.status,
    fare: trip.fare,
    driver: trip.driver || null,
    product: receipt?.vehicleType || null,
    pickup: waypoints[0] ?? null,
    dropoff: waypoints.at(-1) ?? null,
    stops: waypoints.slice(1, -1),
    startedAt: isoOrNull(trip.beginTripTime),
    endedAt: isoOrNull(trip.dropoffTime),
    distance: receipt?.distance ? `${receipt.distance} ${receipt.distanceLabel ?? ""}`.trim() : null,
    duration: receipt?.duration || null,
    surge: trip.isSurgeTrip,
    scheduled: trip.isScheduledRide,
    paymentMethod: trip.paymentProfileUUID,
    url: `https://riders.uber.com/trips/${trip.uuid}`,
    mapImageUrl: getTrip.mapURL ?? null,
    geometry: geometryFromMapUrl(getTrip.mapURL),
  };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, "\n")
    .replace(/<\/td>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (entity, code: string) => {
      if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? entity;
    })
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== ""))
    .join("\n")
    .trim();
}

const AMOUNT = /^(-?[A-Z]{3}\s?[-\d.,]+|-?[$€£]\s?[\d.,]+|[\d.,]+\s?[A-Z]{3})$/;

export function tidyReceipt(text: string): string {
  const merged: string[] = [];
  const raw = text.split("\n");
  for (let index = 0; index < raw.length; index++) {
    const line = raw[index] ?? "";
    const previous = merged.length - 1;
    if (/^[,.;:]$/.test(line) && previous >= 0) {
      merged[previous] = `${merged[previous]}${line} ${raw[index + 1] ?? ""}`.trimEnd();
      index++;
      continue;
    }
    if (AMOUNT.test(line)) {
      let label = previous;
      while (label >= 0 && merged[label] === "") label--;
      if (label >= 0 && !AMOUNT.test(merged[label] ?? "") && !/\t/.test(merged[label] ?? "")) {
        merged.length = label + 1;
        merged[label] = `${merged[label]}\t${line}`;
        continue;
      }
    }
    merged.push(line);
  }
  const deduped = merged.filter((line, index) => {
    if (line === "") return true;
    let previous = index - 1;
    while (previous >= 0 && merged[previous] === "") previous--;
    return merged[previous] !== line;
  });
  const paragraphs = deduped.join("\n").replace(/\n{3,}/g, "\n\n").split(/\n{2,}/);
  return paragraphs.filter((paragraph, index) => paragraphs.indexOf(paragraph) === index).join("\n\n");
}

export type Receipt = { uuid: string; text: string; html: string };

export async function getReceipt(client: UberClient, uuid: string): Promise<Receipt> {
  const { getReceipt } = await client.graphql<{ getReceipt: { receiptData?: string | null } | null }>("GetReceipt", {
    tripUUID: uuid,
  });
  const html = getReceipt?.receiptData;
  if (!html) throw new UberError("not-found", `No receipt for trip ${uuid}.`, "Receipts exist only for completed trips.");
  return { uuid, text: tidyReceipt(htmlToText(html)), html };
}
