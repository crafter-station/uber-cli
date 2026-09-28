import { UberError } from "../app/errors.js";
import type { Payment } from "./account.js";
import type { UberClient } from "./client.js";
import { asInputLocation, type Coordinates, type ResolvedPlace } from "./places.js";

type RawFare = { capacity: number; fare: string; fareAmountE5?: number | null; meta: string };

type RawProduct = {
  id: string;
  is3p: boolean;
  productUuid: string;
  displayName: string;
  description: string;
  detailedDescription?: string | null;
  currencyCode: string;
  estimatedTripTime?: number | null;
  etaInMin?: number | null;
  isAvailable?: boolean;
  productClassificationTypeName?: string | null;
  badges?: { text?: string | null }[] | null;
  fares: RawFare[];
};

type RawProducts = { tiers: { title?: string; products: RawProduct[] }[] };

export type RideOption = {
  id: string;
  name: string;
  description: string;
  tier: string | null;
  seats: number;
  fare: string;
  amount: number | null;
  currency: string;
  pickupInMinutes: number | null;
  arrivesAt: string | null;
  badges: string[];
};

export type RideQuote = {
  option: RideOption;
  vehicleViewId: number;
  vehicleDescription: string;
  is3p: boolean;
  meta: string;
  expiresAt: string;
};

export type Estimate = {
  pickup: ResolvedPlace;
  dropoff: ResolvedPlace;
  quotedAt: string;
  options: RideOption[];
  quotes: RideQuote[];
};

const QUOTE_FALLBACK_TTL_MS = 3 * 60_000;

function quoteExpiry(meta: string, quotedAt: number): string {
  try {
    const seconds = (JSON.parse(meta) as { upfrontFare?: { signature?: { expiresAt?: number } } }).upfrontFare?.signature
      ?.expiresAt;
    if (seconds) return new Date(seconds * 1000).toISOString();
  } catch {}
  return new Date(quotedAt + QUOTE_FALLBACK_TTL_MS).toISOString();
}

function toQuote(product: RawProduct, tier: string | null, quotedAt: number): RideQuote | null {
  const fare = product.fares[0];
  if (!fare || product.isAvailable === false) return null;
  return {
    option: {
      id: product.productUuid,
      name: product.displayName,
      description: product.detailedDescription || product.description,
      tier,
      seats: fare.capacity,
      fare: fare.fare,
      amount: typeof fare.fareAmountE5 === "number" ? fare.fareAmountE5 / 1e5 : null,
      currency: product.currencyCode,
      pickupInMinutes: product.etaInMin ?? null,
      arrivesAt: product.estimatedTripTime ? new Date(quotedAt + product.estimatedTripTime * 1000).toISOString() : null,
      badges: (product.badges ?? []).map((badge) => badge.text ?? "").filter(Boolean),
    },
    vehicleViewId: Number(product.id),
    vehicleDescription: product.description,
    is3p: product.is3p,
    meta: fare.meta,
    expiresAt: quoteExpiry(fare.meta, quotedAt),
  };
}

const coordinate = (place: Coordinates): Coordinates => ({ latitude: place.latitude, longitude: place.longitude });

export async function estimate(
  client: UberClient,
  pickup: ResolvedPlace,
  dropoff: ResolvedPlace,
  payment: Payment,
): Promise<Estimate> {
  const { products } = await client.graphql<{ products: RawProducts }>("Products", {
    pickup: coordinate(pickup),
    destinations: [coordinate(dropoff)],
    includeRecommended: false,
    isHcv: false,
    paymentProfileUUID: payment.method.uuid,
    profileType: payment.profile.type,
    profileUUID: payment.profile.uuid,
    payment: {
      paymentProfileUUID: payment.method.uuid,
      profileType: payment.profile.type,
      profileUUID: payment.profile.uuid,
      uberCashToggleOn: false,
    },
  });
  const quotedAt = Date.now();
  const seen = new Set<string>();
  const quotes = products.tiers.flatMap((tier) =>
    tier.products
      .filter((product) => !seen.has(product.productUuid) && seen.add(product.productUuid))
      .map((product) => toQuote(product, tier.title ?? null, quotedAt))
      .filter((quote) => quote !== null),
  );
  if (quotes.length === 0) {
    throw new UberError("not-found", "No rides are available for this trip right now.", "Try again in a minute or pick other places.");
  }
  return { pickup, dropoff, quotedAt: new Date(quotedAt).toISOString(), options: quotes.map((quote) => quote.option), quotes };
}

const squash = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function pickQuote(result: Estimate, choice: string): RideQuote {
  const needle = squash(choice);
  const quote =
    result.quotes.find((candidate) => candidate.option.id === choice) ??
    result.quotes.find((candidate) => squash(candidate.option.name) === needle) ??
    result.quotes.find((candidate) => squash(candidate.option.name).startsWith(needle));
  if (!quote) {
    throw new UberError(
      "not-found",
      `No ride option "${choice}" for this trip.`,
      `Available: ${result.options.map((option) => option.name).join(", ")}.`,
    );
  }
  return quote;
}

export function tripRequestVariables(result: Estimate, quote: RideQuote, payment: Payment): Record<string, unknown> {
  return {
    capacity: quote.option.seats,
    destinations: [asInputLocation(result.dropoff)],
    locationSource: "SEARCH",
    meta: quote.meta,
    origin: { location: asInputLocation(result.pickup) },
    payment: {
      paymentMethodDisplayName: payment.method.name,
      paymentProfileUUID: payment.method.uuid,
      profileTokenType: payment.tokenType,
      profileType: payment.profile.type,
      profileUUID: payment.profile.uuid,
      useCredits: false,
    },
    type: "ON_DEMAND",
    vehicleView: { description: quote.vehicleDescription, id: quote.vehicleViewId, is3p: quote.is3p },
  };
}

export type RequestedTrip = { uuid: string };

export async function requestTrip(client: UberClient, variables: Record<string, unknown>): Promise<RequestedTrip> {
  const { tripRequest } = await client.graphql<{
    tripRequest: { uuid?: string | null; errorCode?: string | null; errorKey?: string | null };
  }>("TripRequest", variables);
  if (!tripRequest.uuid || tripRequest.errorCode) {
    throw new UberError(
      "upstream",
      `Uber did not accept the request${tripRequest.errorKey ? ` (${tripRequest.errorKey})` : ""}.`,
      "Nothing was booked. Get a fresh estimate and try again, or open the Uber app.",
    );
  }
  return { uuid: tripRequest.uuid };
}

type RawTrip = {
  uuid: string;
  clientStatus: string;
  cancelable: boolean;
  fareString?: string | null;
  eta?: number | null;
  etaStringShort?: string | null;
  etaToDestination?: number | null;
  driver?: { name?: string; rating?: string; pictureUrl?: string; status?: string } | null;
  vehicle?: { make?: string; model?: string; licensePlate?: string; colorTranslatedName?: string; coordinate?: Coordinates } | null;
  pinVerification?: { pin?: string | null } | null;
  statusMessage?: { title?: string | null; subtitle?: string | null } | null;
  waypoints?: { title?: string; subtitle?: string; type?: string; coordinate?: Coordinates | null }[] | null;
  polylines?: { polyline?: string | null }[] | null;
};

export type LiveTrip = {
  uuid: string;
  status: string;
  headline: string | null;
  detail: string | null;
  fare: string | null;
  pickupEta: string | null;
  arrivalEta: string | null;
  cancelable: boolean;
  pin: string | null;
  driver: { name: string; rating: string | null; photo: string | null } | null;
  vehicle: { description: string; plate: string | null; location: Coordinates | null } | null;
  stops: { title: string; type: string | null; location: Coordinates | null }[];
  route: string | null;
};

export type RideStatus = { state: string; trip: LiveTrip | null; lastRequest: { message: string | null } | null };

const inMinutes = (seconds?: number | null): string | null =>
  typeof seconds === "number" && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null;

function toLiveTrip(trip: RawTrip): LiveTrip {
  const vehicle = trip.vehicle;
  return {
    uuid: trip.uuid,
    status: trip.clientStatus,
    headline: trip.statusMessage?.title ?? null,
    detail: trip.statusMessage?.subtitle ?? null,
    fare: trip.fareString ?? null,
    pickupEta: trip.etaStringShort ?? null,
    arrivalEta: inMinutes(trip.etaToDestination),
    cancelable: trip.cancelable,
    pin: trip.pinVerification?.pin ?? null,
    driver: trip.driver?.name
      ? { name: trip.driver.name, rating: trip.driver.rating ?? null, photo: trip.driver.pictureUrl ?? null }
      : null,
    vehicle: vehicle
      ? {
          description: [vehicle.colorTranslatedName, vehicle.make, vehicle.model].filter(Boolean).join(" "),
          plate: vehicle.licensePlate ?? null,
          location: vehicle.coordinate ?? null,
        }
      : null,
    stops: (trip.waypoints ?? []).map((waypoint) => ({
      title: waypoint.title ?? "",
      type: waypoint.type ?? null,
      location: waypoint.coordinate?.latitude ? waypoint.coordinate : null,
    })),
    route: trip.polylines?.find((line) => line.polyline)?.polyline ?? null,
  };
}

export async function rideStatus(client: UberClient): Promise<RideStatus> {
  const { status } = await client.graphql<{
    status: { clientStatus: string; trip: RawTrip | null; lastRequest: { message?: string | null } | null };
  }>("GetStatus", { latitude: 0, longitude: 0 });
  return {
    state: status.clientStatus,
    trip: status.trip ? toLiveTrip(status.trip) : null,
    lastRequest: status.lastRequest ? { message: status.lastRequest.message ?? null } : null,
  };
}

export async function cancelTrip(client: UberClient, uuid: string): Promise<{ cancelled: boolean }> {
  const { tripCancel } = await client.graphql<{ tripCancel: boolean | null }>("TripCancel", { current: true, uuid });
  if (!tripCancel) throw new UberError("upstream", "Uber did not confirm the cancellation.", "Check `uber rides status`.");
  return { cancelled: true };
}

export type NearbyVehicle = Coordinates & { etaMinutes: number | null };

export async function nearbyVehicles(client: UberClient, at: Coordinates): Promise<NearbyVehicle[]> {
  const { status } = await client.graphql<{
    status: { nearbyVehicles?: { coordinate: Coordinates; etaInMin?: number | null }[] | null };
  }>("GetStatus", { latitude: at.latitude, longitude: at.longitude });
  return (status.nearbyVehicles ?? []).map((vehicle) => ({ ...vehicle.coordinate, etaMinutes: vehicle.etaInMin ?? null }));
}
