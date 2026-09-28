import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { field, lines, style, table } from "../cli/style.js";
import { decodeRoute, dropoffMarker, fetchImage, mapView, pickupMarker } from "../cli/visual.js";
import { getAccount, getBalance, getPromotions } from "../uber/account.js";
import { getReceipt, getTrip, listTrips } from "../uber/trips.js";
import { defineCommand, step, withProfile } from "./define.js";

export const me = defineCommand({
  name: "me",
  summary: "Account profile, rating, trip count, payment methods and Uber One",
  risk: "read",
  aliases: ["account"],
  input: {},
  examples: ["uber me"],
  async run(_input, context) {
    return { result: await getAccount(context.client()) };
  },
  render: (account) =>
    lines(
      `${style.bold(account.name)}${account.uberOne ? style.green("  Uber One") : ""}`,
      field("rating", account.rating ? `★ ${account.rating}` : null),
      field("trips", account.completedTrips),
      field("phone", account.phone),
      field("email", account.email),
      field("country", account.country),
      "",
      style.muted("payment methods"),
      table(account.paymentMethods.map((method) => [method.selected ? style.green("●") : " ", method.name, style.muted(method.uuid)])),
    ),
});

export const balance = defineCommand({
  name: "balance",
  summary: "Whether the account owes money from a past trip",
  risk: "read",
  input: {},
  examples: ["uber balance"],
  async run(_input, context) {
    const result = await getBalance(context.client());
    return {
      result,
      next: result.tripUuid ? [step(withProfile(`uber trips get ${result.tripUuid}`, context.profile), "See the trip with the balance")] : [],
    };
  },
  render: (result) =>
    result.owesMoney
      ? `${style.yellow("!")} Outstanding balance${result.amount ? ` ${style.bold(result.amount)}` : ""}. ${style.muted("Settle it in the Uber app or riders.uber.com.")}`
      : `${style.green("✓")} Nothing owed.`,
});

export const promos = defineCommand({
  name: "promos",
  summary: "Promotions and rewards on the account",
  risk: "read",
  input: {},
  examples: ["uber promos"],
  async run(_input, context) {
    return { result: await getPromotions(context.client()) };
  },
  render: (items) =>
    items.length === 0 ? style.muted("No promotions right now.") : table(items.map((item) => [style.bold(item.title), item.description ?? ""])),
});

export const tripsList = defineCommand({
  name: "trips list",
  summary: "Recent and upcoming trips, newest first",
  risk: "read",
  aliases: ["trips", "activity"],
  input: {
    limit: z.coerce.number().int().min(1).max(50).default(10).describe("How many past trips"),
    cursor: z.string().optional().describe("nextCursor from a previous page"),
    business: z.boolean().default(false).describe("Business profile trips instead of personal"),
  },
  examples: ["uber trips", "uber trips list --limit 25", "uber trips list --cursor <nextCursor>"],
  async run(input, context) {
    const result = await listTrips(context.client(), input);
    const first = result.past[0];
    return {
      result,
      next: [
        ...(first ? [step(withProfile(`uber trips get ${first.uuid}`, context.profile), "Details of the latest trip")] : []),
        ...(result.nextCursor ? [step(withProfile(`uber trips list --cursor ${result.nextCursor}`, context.profile), "Older trips")] : []),
      ],
    };
  },
  render: (result) =>
    lines(
      result.upcoming.length > 0 ? `${style.bold("Upcoming")}\n${table(result.upcoming.map((trip) => [trip.when, trip.destination, trip.fare]))}\n` : null,
      table(result.past.map((trip) => [style.muted(trip.when), trip.destination, style.bold(trip.fare), style.muted(trip.uuid.slice(0, 8))])),
    ),
});

export const tripsGet = defineCommand({
  name: "trips get",
  summary: "One trip: route, fare, driver, distance, duration",
  risk: "read",
  input: { uuid: z.string().uuid().describe("Trip UUID from `uber trips`") },
  positionals: ["uuid"],
  examples: ["uber trips get 3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f"],
  async run(input, context) {
    return {
      result: await getTrip(context.client(), input.uuid),
      next: [step(withProfile(`uber trips receipt ${input.uuid}`, context.profile), "The itemized receipt")],
    };
  },
  render: async (trip) => {
    const geometry = trip.geometry;
    const map = geometry
      ? await mapView(
          {
            route: decodeRoute(geometry.polyline),
            markers: [
              ...(geometry.pickup ? [pickupMarker(geometry.pickup, trip.pickup?.split(",")[0])] : []),
              ...(geometry.dropoff ? [dropoffMarker(geometry.dropoff, trip.dropoff?.split(",")[0])] : []),
            ],
          },
          () => fetchImage(trip.mapImageUrl),
        )
      : null;
    return lines(
      map,
      map ? "" : null,
      `${style.bold(trip.fare)}  ${style.muted(trip.status.toLowerCase())}${trip.surge ? style.yellow("  surge") : ""}`,
      field("from", trip.pickup),
      ...trip.stops.map((stop) => field("stop", stop)),
      field("to", trip.dropoff),
      field("when", trip.startedAt ? new Date(trip.startedAt).toLocaleString() : null),
      field("ride", trip.product),
      field("driver", trip.driver),
      field("distance", trip.distance),
      field("duration", trip.duration),
    );
  },
});

export const tripsReceipt = defineCommand({
  name: "trips receipt",
  summary: "Itemized receipt as text, optionally saved as HTML",
  risk: "read",
  input: {
    uuid: z.string().uuid().describe("Trip UUID"),
    save: z.string().optional().describe("Write the receipt HTML to this path"),
  },
  positionals: ["uuid"],
  examples: ["uber trips receipt 3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f", "uber trips receipt <uuid> --save receipt.html"],
  async run(input, context) {
    const receipt = await getReceipt(context.client(), input.uuid);
    const savedTo = input.save ? resolve(input.save) : null;
    if (savedTo) writeFileSync(savedTo, receipt.html);
    return { result: { uuid: receipt.uuid, text: receipt.text, savedTo } };
  },
  render: (result) => lines(result.text, result.savedTo ? style.muted(`\nsaved ${result.savedTo}`) : null),
});
