import type { OperationName } from "../graphql/documents.generated.js";

export type SurfaceName = "riders" | "rides" | "eats";

export type Surface = {
  name: SurfaceName;
  label: string;
  endpoint: string;
  loginUrl: string;
  landedOn: RegExp;
};

export const SURFACES: Record<SurfaceName, Surface> = {
  riders: {
    name: "riders",
    label: "Trips, receipts and account",
    endpoint: "https://riders.uber.com/graphql",
    loginUrl: "https://riders.uber.com/trips",
    landedOn: /^https:\/\/riders\.uber\.com\//,
  },
  rides: {
    name: "rides",
    label: "Places, fares and ride requests",
    endpoint: "https://m.uber.com/go/graphql",
    loginUrl: "https://m.uber.com/go/login-redirect?previousPathname=%2Fgo%2Fhome",
    landedOn: /^https:\/\/m\.uber\.com\/go\/(?!login)/,
  },
  eats: {
    name: "eats",
    label: "Uber Eats",
    endpoint: "https://www.ubereats.com/_p/api/",
    loginUrl: "https://www.ubereats.com/login-redirect/",
    landedOn: /^https:\/\/www\.ubereats\.com\/(?!login)/,
  },
};

export const SURFACE_NAMES = Object.keys(SURFACES) as SurfaceName[];

export const AUTH_HOST = /^https:\/\/auth\.uber\.com\//;

export const OPERATION_SURFACE: Record<OperationName, "riders" | "rides"> = {
  Activities: "riders",
  CurrentUserRidersWeb: "riders",
  GetArrears: "riders",
  GetReceipt: "riders",
  GetTrip: "riders",
  RatingDetails: "riders",
  CancellationInformation: "rides",
  GetPromotions: "rides",
  GetStatus: "rides",
  GetUpcomingTrip: "rides",
  Products: "rides",
  PudoLocationSearch: "rides",
  PudoResolveLocationPudoFragment: "rides",
  RiderCompletedTripsCount: "rides",
  SavedPlaces: "rides",
  TripCancel: "rides",
  TripRequest: "rides",
};
