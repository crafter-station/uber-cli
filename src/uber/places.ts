import { UberError } from "../app/errors.js";
import type { UberClient } from "./client.js";

type RawPlace = {
  id: string;
  provider: string;
  source: string;
  addressLine1: string;
  addressLine2: string;
  categories?: string[];
  tag?: string | null;
  savedPlacesMeta?: { label?: string | null; tag?: string | null } | null;
  coordinate?: { latitude: number; longitude: number } | null;
  timezone?: string | null;
};

export type Coordinates = { latitude: number; longitude: number };

export type Place = {
  id: string;
  provider: string;
  source: string;
  name: string;
  address: string;
  label: string | null;
  kind: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type ResolvedPlace = Place &
  Coordinates & { matchedBy: "coordinates" | "saved" | "id" | "search"; alternatives?: Place[] };

export type PlaceKind = "PICKUP" | "DROPOFF";

const COORDINATES = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const PLACE_ID = /^(ChIJ|Ei|Eh|Gh|Ej)[A-Za-z0-9_-]{10,}$/;

const toPlace = (raw: RawPlace): Place => ({
  id: raw.id,
  provider: raw.provider,
  source: raw.source,
  name: raw.addressLine1,
  address: raw.addressLine2,
  label: raw.savedPlacesMeta?.label ?? null,
  kind: raw.savedPlacesMeta?.tag ?? raw.tag ?? null,
  latitude: raw.coordinate?.latitude ?? null,
  longitude: raw.coordinate?.longitude ?? null,
});

export async function approximateLocation(client: UberClient): Promise<Coordinates & { city: string; currency: string }> {
  const { status } = await client.graphql<{
    status: { coordinate: Coordinates; city: { name: string; currencyCode: string } };
  }>("GetStatus", { latitude: 0, longitude: 0 });
  return { ...status.coordinate, city: status.city.name, currency: status.city.currencyCode };
}

export async function searchPlaces(
  client: UberClient,
  query: string,
  options: { near?: Coordinates; kind?: PlaceKind } = {},
): Promise<Place[]> {
  const near = options.near ?? (await approximateLocation(client));
  const { pudoLocationSearch } = await client.graphql<{ pudoLocationSearch: RawPlace[] }>("PudoLocationSearch", {
    latitude: near.latitude,
    longitude: near.longitude,
    query,
    type: options.kind ?? "DROPOFF",
  });
  return pudoLocationSearch.map(toPlace);
}

export async function savedPlaces(client: UberClient): Promise<Place[]> {
  const { savedPlaces } = await client.graphql<{ savedPlaces: RawPlace[] }>("SavedPlaces");
  return savedPlaces.map(toPlace);
}

async function withCoordinates(client: UberClient, place: Place): Promise<Place & Coordinates> {
  if (place.latitude !== null && place.longitude !== null) {
    return { ...place, latitude: place.latitude, longitude: place.longitude };
  }
  const { pudoResolveLocation } = await client.graphql<{ pudoResolveLocation: RawPlace | null }>(
    "PudoResolveLocationPudoFragment",
    { id: place.id, provider: place.provider, source: place.source, includeTimezone: true },
  );
  const resolved = pudoResolveLocation;
  if (!resolved?.coordinate) throw new UberError("not-found", `Uber could not locate "${place.name}".`);
  const unnamed = place.name === place.id;
  return {
    ...place,
    name: unnamed ? resolved.addressLine1 || place.name : place.name,
    address: unnamed || !place.address ? resolved.addressLine2 || place.address : place.address,
    latitude: resolved.coordinate.latitude,
    longitude: resolved.coordinate.longitude,
  };
}

function matchSaved(places: Place[], input: string): Place | undefined {
  const needle = input.trim().toLowerCase();
  return (
    places.find((place) => place.label?.toLowerCase() === needle || place.kind?.toLowerCase() === needle) ??
    places.find((place) => place.label?.toLowerCase().includes(needle))
  );
}

export async function resolvePlace(
  client: UberClient,
  input: string,
  options: { kind: PlaceKind; near?: Coordinates },
): Promise<ResolvedPlace> {
  const coordinates = COORDINATES.exec(input);
  if (coordinates) {
    const latitude = Number(coordinates[1]);
    const longitude = Number(coordinates[2]);
    return {
      id: "",
      provider: "",
      source: "MANUAL",
      name: input.trim(),
      address: "",
      label: null,
      kind: null,
      latitude,
      longitude,
      matchedBy: "coordinates",
    };
  }

  if (PLACE_ID.test(input.trim())) {
    const place = await withCoordinates(client, {
      id: input.trim(),
      provider: "google_places",
      source: "SEARCH",
      name: input.trim(),
      address: "",
      label: null,
      kind: null,
      latitude: null,
      longitude: null,
    });
    return { ...place, matchedBy: "id" };
  }

  const saved = matchSaved(await savedPlaces(client), input);
  if (saved) return { ...(await withCoordinates(client, saved)), matchedBy: "saved" };

  const [best, ...others] = await searchPlaces(client, input, options);
  if (!best) {
    throw new UberError("not-found", `No place matches "${input}".`, "Try a fuller address, a saved place label, or lat,lng.");
  }
  return { ...(await withCoordinates(client, best)), matchedBy: "search", alternatives: others.slice(0, 3) };
}

export const asInputLocation = (place: ResolvedPlace) => ({
  addressLine1: place.name,
  addressLine2: place.address,
  coordinate: { latitude: place.latitude, longitude: place.longitude },
  id: place.id,
  provider: place.provider,
  source: place.source === "MANUAL" ? "SEARCH" : place.source,
});
