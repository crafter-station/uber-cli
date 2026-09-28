import { z } from "zod";
import { UberError } from "../app/errors.js";
import { assertWritesAllowed, audit, createPending, takePending } from "../app/safety.js";
import { clock, field, lines, style, table } from "../cli/style.js";
import { decodeRoute, driverMarker, dropoffMarker, isRealLocation, mapView, pickupMarker } from "../cli/visual.js";
import { type Payment, resolvePayment } from "../uber/account.js";
import type { UberClient } from "../uber/client.js";
import { type ResolvedPlace, resolvePlace } from "../uber/places.js";
import {
  cancelTrip,
  type LiveTrip,
  type Estimate,
  estimate,
  pickQuote,
  type RideOption,
  type RideQuote,
  type NearbyVehicle,
  nearbyVehicles,
  requestTrip,
  rideStatus,
  tripRequestVariables,
} from "../uber/rides.js";
import { type Context, defineCommand, type Outcome, step, withProfile } from "./define.js";


const place = z.string().min(1);

const PLACE_HELP = "Saved place label (home, work…), lat,lng, a Google place id, or an address to search";

const REQUEST_TOKEN_TTL_MS = 10 * 60_000;
const CANCEL_TOKEN_TTL_MS = 2 * 60_000;

type PlaceView = {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  matchedBy: ResolvedPlace["matchedBy"];
  alternatives?: { id: string; name: string; address: string }[];
};

const placeView = (resolved: ResolvedPlace): PlaceView => ({
  name: resolved.name,
  address: resolved.address,
  latitude: resolved.latitude,
  longitude: resolved.longitude,
  matchedBy: resolved.matchedBy,
  ...(resolved.alternatives?.length
    ? { alternatives: resolved.alternatives.map((place) => ({ id: place.id, name: place.name, address: place.address })) }
    : {}),
});

const alternativesLine = (view: PlaceView, flag: string): string | null =>
  view.alternatives?.length
    ? style.muted(`  ${flag} matched by search; others: ${view.alternatives.map((place) => `${place.name} (${place.id})`).join(" · ")}`)
    : null;

async function quoteTrip(
  client: UberClient,
  context: Context,
  input: { from: string; to: string; payment?: string },
): Promise<{ estimate: Estimate; payment: Payment }> {
  context.progress("Finding the places…");
  const payment = await resolvePayment(client, input.payment);
  const pickup = await resolvePlace(client, input.from, { kind: "PICKUP" });
  const dropoff = await resolvePlace(client, input.to, { kind: "DROPOFF", near: pickup });
  context.progress("Asking Uber for prices…");
  return { estimate: await estimate(client, pickup, dropoff, payment), payment };
}

const tripMap = (pickup: PlaceView, dropoff: PlaceView, vehicles: NearbyVehicle[] = []) =>
  mapView({
    route: [pickup, dropoff],
    routeStyle: "dashed",
    markers: [pickupMarker(pickup, pickup.name), dropoffMarker(dropoff, dropoff.name)],
    vehicles,
  });

const optionRow = (option: RideOption): string[] => [
  style.bold(option.name),
  option.fare,
  style.muted(option.pickupInMinutes !== null ? `${option.pickupInMinutes} min away` : ""),
  style.muted(option.arrivesAt ? `arrive ${clock(option.arrivesAt)}` : ""),
  style.muted(option.seats === 1 ? "1 seat" : `${option.seats} seats`),
];

export const ridesEstimate = defineCommand({
  name: "rides estimate",
  summary: "Live prices and pickup times for every ride option between two places",
  risk: "read",
  aliases: ["estimate", "fares", "prices"],
  input: {
    from: place.describe(`Pickup. ${PLACE_HELP}`),
    to: place.describe(`Dropoff. ${PLACE_HELP}`),
    payment: z.string().optional().describe("Payment method name or uuid (default: last used)"),
  },
  examples: ['uber rides estimate --from home --to "El Dorado airport"', "uber rides estimate --from 4.6766,-74.0482 --to 4.60,-74.07"],
  async run(input, context) {
    const client = context.client();
    const { estimate: result, payment } = await quoteTrip(client, context, input);
    const vehicles = await nearbyVehicles(client, result.pickup).catch(() => []);
    const cheapest = [...result.options].sort((a, b) => (a.amount ?? Infinity) - (b.amount ?? Infinity))[0];
    const route = `--from "${input.from}" --to "${input.to}"`;
    return {
      result: {
        pickup: placeView(result.pickup),
        dropoff: placeView(result.dropoff),
        payment: payment.method.name,
        quotedAt: result.quotedAt,
        nearbyVehicles: vehicles,
        options: result.options,
      },
      next: cheapest
        ? [step(withProfile(`uber rides request ${route} --product "${cheapest.name}"`, context.profile), "Preview booking the cheapest option (nothing is booked yet)")]
        : [],
    };
  },
  render: async (result) => {
    const map = await tripMap(result.pickup, result.dropoff, result.nearbyVehicles);
    return lines(
      map,
      map ? "" : null,
      `${style.bold(result.pickup.name)} ${style.muted("→")} ${style.bold(result.dropoff.name)}  ${style.muted(result.payment)}`,
      alternativesLine(result.pickup, "--from"),
      alternativesLine(result.dropoff, "--to"),
      result.nearbyVehicles.length > 0 ? style.muted(`${result.nearbyVehicles.length} cars nearby`) : null,
      "",
      table(result.options.map(optionRow)),
    );
  },
});

type RidePayload = {
  from: string;
  to: string;
  productId: string;
  productName: string;
  paymentUuid: string;
  approvedAmount: number | null;
  approvedFare: string;
  quoteExpiresAt: string;
  variables: Record<string, unknown>;
};

type RidePreview = {
  status: "preview";
  confirmToken: string;
  expiresAt: string;
  ride: RideOption;
  pickup: PlaceView;
  dropoff: PlaceView;
  payment: string;
  notice: string;
};

type RideBooked = {
  status: "requested";
  tripUuid: string;
  ride: string;
  fare: string;
  requoted: boolean;
};

function withinCeiling(quote: RideQuote, ceiling: number | null): boolean {
  return quote.option.amount !== null && ceiling !== null && quote.option.amount <= ceiling;
}

async function confirmRide(token: string, context: Context): Promise<Outcome<RideBooked>> {
  assertWritesAllowed(token);
  const pending = takePending<RidePayload>(token, "rides.request", context.profile);
  const payload = pending.payload;
  if (Date.parse(pending.expiresAt) < Date.now()) {
    throw new UberError("blocked.confirm", "This preview expired before it was confirmed.", "Run the request again without --confirm for a fresh price.");
  }

  const client = context.client();
  let variables = payload.variables;
  let fare = payload.approvedFare;
  let requoted = false;

  if (Date.parse(payload.quoteExpiresAt) < Date.now() + 15_000) {
    context.progress("The price quote aged out; getting a fresh one…");
    const fresh = await quoteTrip(client, context, { from: payload.from, to: payload.to, payment: payload.paymentUuid });
    const quote = pickQuote(fresh.estimate, payload.productId);
    if (!withinCeiling(quote, payload.approvedAmount)) {
      const retry = createPending("rq", "rides.request", context.profile, pending.summary, {
        ...payload,
        approvedAmount: quote.option.amount,
        approvedFare: quote.option.fare,
        quoteExpiresAt: quote.expiresAt,
        variables: tripRequestVariables(fresh.estimate, quote, fresh.payment),
      }, new Date(Date.now() + REQUEST_TOKEN_TTL_MS));
      throw new UberError(
        "blocked.confirm",
        `The price went from ${payload.approvedFare} to ${quote.option.fare}; nothing was booked.`,
        `If the rider accepts the new price, confirm with \`${withProfile(`uber rides request --confirm ${retry.token}`, context.profile)}\`.`,
      );
    }
    variables = tripRequestVariables(fresh.estimate, quote, fresh.payment);
    fare = quote.option.fare;
    requoted = true;
  }

  audit({ action: "rides.request", profile: context.profile, outcome: "started", token, detail: { ride: payload.productName, fare, from: payload.from, to: payload.to } });
  try {
    context.progress("Requesting the ride…");
    const trip = await requestTrip(client, variables);
    audit({ action: "rides.request", profile: context.profile, outcome: "succeeded", token, detail: { tripUuid: trip.uuid } });
    return {
      result: { status: "requested", tripUuid: trip.uuid, ride: payload.productName, fare, requoted },
      next: [
        step(withProfile("uber rides status", context.profile), "Driver, car, plate, PIN and ETA"),
        step(withProfile("uber rides cancel", context.profile), "Preview cancelling (a fee may apply)"),
      ],
    };
  } catch (error) {
    audit({ action: "rides.request", profile: context.profile, outcome: "failed", token, detail: { error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

export const ridesRequest = defineCommand({
  name: "rides request",
  summary: "Book a ride: previews first, books only with the confirm token",
  guidance:
    "MONEY. Call without `confirm` to get a preview and a confirmToken; nothing is booked. Show the rider the ride, fare, pickup and dropoff, and get an explicit yes. Only then call again with `confirm`. The approved fare is a ceiling: if the price rises before confirmation, nothing is booked and a new preview is returned. Use `maxFare` to refuse anything above a budget.",
  risk: "money",
  input: {
    from: place.optional().describe(`Pickup. ${PLACE_HELP}`),
    to: place.optional().describe(`Dropoff. ${PLACE_HELP}`),
    product: z.string().optional().describe('Ride option name or id from `rides estimate` (e.g. "Comfort", "UberX", "Moto")'),
    payment: z.string().optional().describe("Payment method name or uuid (default: last used)"),
    maxFare: z.coerce.number().positive().optional().describe("Refuse if the fare is above this amount (in the fare currency)"),
    confirm: z.string().optional().describe("confirmToken from the preview; this books the ride"),
  },
  examples: [
    'uber rides request --from home --to "Centro Andino" --product Comfort',
    'uber rides request --from home --to work --product "Uber Planet" --max-fare 30000',
    "uber rides request --confirm rq_ab12cd34ef56",
  ],
  async run(input, context): Promise<Outcome<RidePreview | RideBooked>> {
    if (input.confirm) return confirmRide(input.confirm, context);
    if (!input.from || !input.to || !input.product) {
      throw new UberError("usage", "A preview needs --from, --to and --product.", "Get the options with `uber rides estimate --from … --to …`.");
    }
    const client = context.client();
    const { estimate: result, payment } = await quoteTrip(client, context, { from: input.from, to: input.to, payment: input.payment });
    const quote = pickQuote(result, input.product);
    if (input.maxFare !== undefined && (quote.option.amount === null || quote.option.amount > input.maxFare)) {
      throw new UberError("blocked.max-fare", `${quote.option.name} costs ${quote.option.fare}, above the ${input.maxFare} limit.`, "Pick a cheaper option or raise --max-fare.");
    }
    const summary = { ride: quote.option.name, fare: quote.option.fare, from: result.pickup.name, to: result.dropoff.name, payment: payment.method.name };
    const pending = createPending<RidePayload>(
      "rq",
      "rides.request",
      context.profile,
      summary,
      {
        from: input.from,
        to: input.to,
        productId: quote.option.id,
        productName: quote.option.name,
        paymentUuid: payment.method.uuid,
        approvedAmount: quote.option.amount,
        approvedFare: quote.option.fare,
        quoteExpiresAt: quote.expiresAt,
        variables: tripRequestVariables(result, quote, payment),
      },
      new Date(Date.now() + REQUEST_TOKEN_TTL_MS),
    );
    const preview: RidePreview = {
      status: "preview",
      confirmToken: pending.token,
      expiresAt: pending.expiresAt,
      ride: quote.option,
      pickup: placeView(result.pickup),
      dropoff: placeView(result.dropoff),
      payment: payment.method.name,
      notice: "Nothing is booked. Confirming charges this payment method; the fare above is the most it will book at.",
    };
    return {
      result: preview,
      next: [step(withProfile(`uber rides request --confirm ${pending.token}`, context.profile), `Book ${quote.option.name} for ${quote.option.fare}, only after the rider says yes`)],
    };
  },
  render: async (result) => {
    if (result.status !== "preview") {
      return `${style.green("✓")} Requested ${style.bold(result.ride)} ${result.fare} ${style.muted(result.tripUuid)}`;
    }
    const map = await tripMap(result.pickup, result.dropoff);
    return lines(
      map,
      map ? "" : null,
      `${style.yellow("preview")}  ${style.bold(result.ride.name)} ${style.bold(result.ride.fare)}`,
      field("from", `${result.pickup.name} ${style.muted(result.pickup.address)}`),
      field("to", `${result.dropoff.name} ${style.muted(result.dropoff.address)}`),
      alternativesLine(result.pickup, "--from"),
      alternativesLine(result.dropoff, "--to"),
      field("pickup in", result.ride.pickupInMinutes !== null ? `${result.ride.pickupInMinutes} min` : null),
      field("arrive", clock(result.ride.arrivesAt)),
      field("payment", result.payment),
      field("token", `${result.confirmToken} ${style.muted(`(valid until ${clock(result.expiresAt)})`)}`),
      style.muted(`\n${result.notice}`),
    );
  },
});

export const ridesStatus = defineCommand({
  name: "rides status",
  summary: "The ride in progress: driver, car, plate, PIN, ETA and fare",
  risk: "read",
  aliases: ["ride"],
  input: {},
  examples: ["uber rides status"],
  async run(_input, context) {
    const status = await rideStatus(context.client());
    return {
      result: status,
      next: status.trip?.cancelable ? [step(withProfile("uber rides cancel", context.profile), "Preview cancelling this ride")] : [],
    };
  },
  render: async (status) => {
    const trip = status.trip;
    if (!trip) return style.muted("No ride in progress.");
    const stops = trip.stops.filter((stop) => isRealLocation(stop.location));
    const car = isRealLocation(trip.vehicle?.location) ? trip.vehicle?.location : null;
    const map = await mapView({
      route: decodeRoute(trip.route),
      markers: [
        ...stops.map((stop, index) =>
          index === 0 && stop.type !== "Dropoff"
            ? pickupMarker(stop.location as NonNullable<typeof stop.location>, stop.title)
            : dropoffMarker(stop.location as NonNullable<typeof stop.location>, stop.title),
        ),
        ...(car ? [driverMarker(car, trip.vehicle?.plate || undefined)] : []),
      ],
    });
    return lines(
      map,
      map ? "" : null,
      `${style.bold(trip.headline ?? trip.status)} ${style.muted(trip.detail ?? "")}`,
      field("driver", trip.driver ? `${trip.driver.name}${trip.driver.rating ? ` ★ ${trip.driver.rating}` : ""}` : null),
      field("car", trip.vehicle?.description),
      field("plate", trip.vehicle?.plate ? style.bold(trip.vehicle.plate) : null),
      field("PIN", trip.pin ? style.bold(trip.pin) : null),
      field("pickup", trip.pickupEta),
      field("arrive", clock(trip.arrivalEta)),
      field("fare", trip.fare),
    );
  },
});

type CancelPayload = { tripUuid: string };

type CancelPreview = { status: "preview"; confirmToken: string; expiresAt: string; trip: LiveTrip; notice: string };

type CancelDone = { status: "cancelled"; tripUuid: string; cancelled: boolean };

export const ridesCancel = defineCommand({
  name: "rides cancel",
  summary: "Cancel the ride in progress: previews first, cancels only with the confirm token",
  guidance:
    "MONEY. Uber may charge a cancellation fee once a driver is on the way. Call without `confirm` to preview, tell the rider, and only call with `confirm` after an explicit yes.",
  risk: "money",
  input: { confirm: z.string().optional().describe("confirmToken from the preview; this cancels the ride") },
  examples: ["uber rides cancel", "uber rides cancel --confirm rc_ab12cd34ef56"],
  async run(input, context): Promise<Outcome<CancelPreview | CancelDone>> {
    const client = context.client();
    if (input.confirm) {
      assertWritesAllowed(input.confirm);
      const pending = takePending<CancelPayload>(input.confirm, "rides.cancel", context.profile);
      if (Date.parse(pending.expiresAt) < Date.now()) {
        throw new UberError("blocked.confirm", "This cancel preview expired.", "Run `uber rides cancel` again.");
      }
      audit({ action: "rides.cancel", profile: context.profile, outcome: "started", token: input.confirm, detail: pending.payload });
      try {
        const result = await cancelTrip(client, pending.payload.tripUuid);
        audit({ action: "rides.cancel", profile: context.profile, outcome: "succeeded", token: input.confirm });
        return { result: { status: "cancelled", tripUuid: pending.payload.tripUuid, ...result } };
      } catch (error) {
        audit({ action: "rides.cancel", profile: context.profile, outcome: "failed", token: input.confirm, detail: { error: String(error) } });
        throw error;
      }
    }
    const status = await rideStatus(client);
    const trip = status.trip;
    if (!trip) throw new UberError("not-found", "There is no ride in progress to cancel.");
    if (!trip.cancelable) throw new UberError("blocked.confirm", "Uber does not allow cancelling this ride from here.", "Use the Uber app.");
    const pending = createPending<CancelPayload>(
      "rc",
      "rides.cancel",
      context.profile,
      { driver: trip.driver?.name ?? null, status: trip.status },
      { tripUuid: trip.uuid },
      new Date(Date.now() + CANCEL_TOKEN_TTL_MS),
    );
    return {
      result: {
        status: "preview",
        confirmToken: pending.token,
        expiresAt: pending.expiresAt,
        trip,
        notice: "Nothing is cancelled yet. Uber may charge a cancellation fee once a driver is on the way.",
      },
      next: [step(withProfile(`uber rides cancel --confirm ${pending.token}`, context.profile), "Cancel, only after the rider says yes")],
    };
  },
  render: (result) =>
    result.status === "preview"
      ? lines(
          `${style.yellow("preview")}  cancel ${style.bold(result.trip.headline ?? result.trip.status)}`,
          field("driver", result.trip.driver?.name),
          field("token", `${result.confirmToken} ${style.muted(`(valid until ${clock(result.expiresAt)})`)}`),
          style.muted(`\n${result.notice}`),
        )
      : `${style.green("✓")} Ride cancelled ${style.muted(result.tripUuid)}`,
});
