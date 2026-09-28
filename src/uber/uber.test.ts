import { describe, expect, test } from "bun:test";
import type { Payment } from "./account.js";
import type { ResolvedPlace } from "./places.js";
import { type Estimate, pickQuote, type RideQuote, tripRequestVariables } from "./rides.js";
import { htmlToText, tidyReceipt } from "./trips.js";

const place = (name: string, latitude: number, longitude: number): ResolvedPlace => ({
  id: `id-${name}`,
  provider: "google_places",
  source: "SEARCH",
  name,
  address: "Bogotá",
  label: null,
  kind: null,
  latitude,
  longitude,
  matchedBy: "search",
});

const quote = (name: string, amount: number): RideQuote => ({
  option: {
    id: `uuid-${name}`,
    name,
    description: name,
    tier: null,
    seats: 4,
    fare: `COP ${amount}`,
    amount,
    currency: "COP",
    pickupInMinutes: 3,
    arrivesAt: null,
    badges: [],
  },
  vehicleViewId: 20070225,
  vehicleDescription: name,
  is3p: false,
  meta: '{"fareSessionUUID":"x"}',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

const estimate: Estimate = {
  pickup: place("Parque 93", 4.6766, -74.0482),
  dropoff: place("Andino", 4.66, -74.05),
  quotedAt: new Date().toISOString(),
  quotes: [quote("Uber Planet", 25988), quote("Moto Wait & Save", 15900), quote("Moto", 17913)],
  options: [],
};

const payment: Payment = {
  method: { uuid: "pm-1", name: "Visa ••••1234", type: "braintree", selected: true },
  profile: { uuid: "profile-1", name: "Personal", type: "Personal", defaultPaymentMethod: null },
  tokenType: "braintree",
};

describe("ride options", () => {
  test("match by id, exact name, then prefix, ignoring case and symbols", () => {
    expect(pickQuote(estimate, "uuid-Moto").option.name).toBe("Moto");
    expect(pickQuote(estimate, "moto").option.name).toBe("Moto");
    expect(pickQuote(estimate, "uber-planet").option.name).toBe("Uber Planet");
    expect(pickQuote(estimate, "Moto Wait").option.name).toBe("Moto Wait & Save");
  });

  test("unknown option lists what exists", () => {
    expect(() => pickQuote({ ...estimate, options: estimate.quotes.map((q) => q.option) }, "Helicopter")).toThrow(/No ride option/);
  });

  test("trip request carries the signed fare and the web app's shapes", () => {
    const variables = tripRequestVariables(estimate, estimate.quotes[0] as RideQuote, payment);
    expect(variables).toMatchObject({
      type: "ON_DEMAND",
      meta: '{"fareSessionUUID":"x"}',
      capacity: 4,
      vehicleView: { id: 20070225, description: "Uber Planet", is3p: false },
      origin: { location: { addressLine1: "Parque 93", coordinate: { latitude: 4.6766, longitude: -74.0482 } } },
      destinations: [{ addressLine1: "Andino", coordinate: { latitude: 4.66, longitude: -74.05 } }],
      payment: { paymentProfileUUID: "pm-1", profileUUID: "profile-1", profileType: "Personal", useCredits: false },
    });
  });
});

describe("receipts", () => {
  test("html becomes readable text", () => {
    const html = "<html><head><style>p{}</style></head><body><h1>Total</h1><table><tr><td>Trip fare</td><td>COP&nbsp;12,456</td></tr></table><p>Thanks &amp; see you</p></body></html>";
    expect(htmlToText(html)).toBe("Total\nTrip fare COP 12,456\n\nThanks & see you");
  });

  test("amounts join their labels, stray commas merge, repeated blocks drop", () => {
    const text = "Sep 28, 2026\n,\n9:34 AM\n\nSep 28, 2026\n,\n9:34 AM\n\nTotal\nCOP 12,456\n\nBooking Fee\n\nCOP 782";
    expect(tidyReceipt(text)).toBe("Sep 28, 2026, 9:34 AM\n\nTotal\tCOP 12,456\n\nBooking Fee\tCOP 782");
  });
});
