import { z } from "zod";
import { UberError } from "../app/errors.js";
import { style, table } from "../cli/style.js";
import { type Coordinates, type Place, savedPlaces, searchPlaces } from "../uber/places.js";
import { defineCommand } from "./define.js";

export const coordinatesInput = z
  .string()
  .regex(/^\s*-?\d{1,2}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?\s*$/, "Use lat,lng")
  .describe("Bias results near lat,lng");

export function parseCoordinates(value: string | undefined): Coordinates | undefined {
  if (!value) return undefined;
  const [latitude, longitude] = value.split(",").map((part) => Number(part.trim()));
  if (latitude === undefined || longitude === undefined || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw new UberError("usage", `"${value}" is not lat,lng.`);
  }
  return { latitude, longitude };
}

const renderPlaces = (places: Place[]): string =>
  places.length === 0
    ? style.muted("Nothing found.")
    : table(places.map((place) => [place.label ? style.cyan(place.label) : "", style.bold(place.name), style.muted(place.address)]));

export const placesSearch = defineCommand({
  name: "places search",
  summary: "Find pickup or dropoff places the way the Uber app does",
  risk: "read",
  input: {
    query: z.string().min(1).describe("Address, venue or landmark"),
    near: coordinatesInput.optional(),
    pickup: z.boolean().default(false).describe("Rank as pickup points instead of destinations"),
  },
  variadic: "query",
  examples: ['uber places search "Centro Andino"', 'uber places search "airport" --near 4.6766,-74.0482'],
  async run(input, context) {
    return {
      result: await searchPlaces(context.client(), input.query, {
        near: parseCoordinates(input.near),
        kind: input.pickup ? "PICKUP" : "DROPOFF",
      }),
    };
  },
  render: renderPlaces,
});

export const placesSaved = defineCommand({
  name: "places saved",
  summary: "Saved places (home, work, favorites) usable as --from/--to by label",
  risk: "read",
  aliases: ["places"],
  input: {},
  examples: ["uber places saved"],
  async run(_input, context) {
    return { result: await savedPlaces(context.client()) };
  },
  render: renderPlaces,
});
