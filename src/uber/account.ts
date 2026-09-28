import { UberError } from "../app/errors.js";
import type { Account as StoredAccount } from "../session/vault.js";
import type { UberClient } from "./client.js";

type RawPaymentProfile = {
  uuid: string;
  tokenType: string;
  displayable?: { displayName?: string };
  hasBalance?: boolean;
};

type RawProfile = {
  uuid: string;
  name: string;
  type: string;
  defaultPaymentProfileUuid?: string | null;
};

type RawUser = {
  uuid: string;
  firstName: string;
  lastName: string;
  email?: string;
  formattedNumber?: string;
  rating?: string;
  signupCountry?: string;
  lastSelectedPaymentProfileUuid?: string;
  paymentProfiles?: RawPaymentProfile[];
  profiles?: RawProfile[];
  membershipBenefits?: { hasUberOne?: boolean };
  uberCashBalances?: { amount?: string; currencyCode?: string }[];
};

export type PaymentMethod = { uuid: string; name: string; type: string; selected: boolean };

export type RiderProfile = { uuid: string; name: string; type: string; defaultPaymentMethod: string | null };

export type Account = {
  uuid: string;
  name: string;
  email: string | null;
  phone: string | null;
  rating: string | null;
  country: string | null;
  uberOne: boolean;
  completedTrips: number | null;
  paymentMethods: PaymentMethod[];
  profiles: RiderProfile[];
};

export type Payment = {
  method: PaymentMethod;
  profile: RiderProfile;
  tokenType: string;
};

async function rawUser(client: UberClient): Promise<RawUser> {
  const data = await client.graphql<{ currentUser: RawUser }>("CurrentUserRidersWeb", {
    includeDelegateProfiles: true,
    includeUserMemberships: true,
  });
  return data.currentUser;
}

function paymentMethods(user: RawUser): PaymentMethod[] {
  return (user.paymentProfiles ?? []).map((profile) => ({
    uuid: profile.uuid,
    name: profile.displayable?.displayName ?? profile.tokenType,
    type: profile.tokenType,
    selected: profile.uuid === user.lastSelectedPaymentProfileUuid,
  }));
}

function riderProfiles(user: RawUser): RiderProfile[] {
  return (user.profiles ?? []).map((profile) => ({
    uuid: profile.uuid,
    name: profile.name,
    type: profile.type,
    defaultPaymentMethod: profile.defaultPaymentProfileUuid ?? null,
  }));
}

export async function getAccount(client: UberClient): Promise<Account> {
  const [user, count] = await Promise.all([
    rawUser(client),
    client
      .graphql<{ riderCompletedTripsCount: number }>("RiderCompletedTripsCount")
      .then((data) => data.riderCompletedTripsCount)
      .catch(() => null),
  ]);
  return {
    uuid: user.uuid,
    name: `${user.firstName} ${user.lastName}`.trim(),
    email: user.email ?? null,
    phone: user.formattedNumber ?? null,
    rating: user.rating ?? null,
    country: user.signupCountry ?? null,
    uberOne: user.membershipBenefits?.hasUberOne ?? false,
    completedTrips: count,
    paymentMethods: paymentMethods(user),
    profiles: riderProfiles(user),
  };
}

export const toStoredAccount = (account: Account): StoredAccount => ({
  uuid: account.uuid,
  name: account.name,
  ...(account.email ? { email: account.email } : {}),
  ...(account.phone ? { phone: account.phone } : {}),
  ...(account.rating ? { rating: account.rating } : {}),
  ...(account.country ? { country: account.country } : {}),
});

export async function resolvePayment(client: UberClient, choice?: string): Promise<Payment> {
  const user = await rawUser(client);
  const methods = paymentMethods(user);
  const profiles = riderProfiles(user);
  const needle = choice?.toLowerCase();
  const method = needle
    ? methods.find((candidate) => candidate.uuid === choice || candidate.name.toLowerCase().includes(needle))
    : (methods.find((candidate) => candidate.selected) ?? methods[0]);
  if (!method) {
    throw new UberError(
      needle ? "not-found" : "upstream",
      needle ? `No payment method matches "${choice}".` : "The account has no payment method.",
      "`uber me` lists the payment methods on the account.",
    );
  }
  const profile = profiles.find((candidate) => candidate.type === "Personal") ?? profiles[0];
  if (!profile) throw new UberError("upstream", "The account has no rider profile.");
  const tokenType = (user.paymentProfiles ?? []).find((raw) => raw.uuid === method.uuid)?.tokenType ?? "";
  return { method, profile, tokenType };
}

export type Balance = { owesMoney: boolean; amount: string | null; tripUuid: string | null };

export async function getBalance(client: UberClient): Promise<Balance> {
  const { getArrears } = await client.graphql<{
    getArrears: { hasArrears: boolean; amountString: string | null; tripUUID: string | null };
  }>("GetArrears", { enableNewArrearFlow: true });
  return { owesMoney: getArrears.hasArrears, amount: getArrears.amountString, tripUuid: getArrears.tripUUID };
}

export type Promotion = { title: string; description: string | null; expiresAt: string | null };

export async function getPromotions(client: UberClient): Promise<Promotion[]> {
  const { getPromotions } = await client.graphql<{ getPromotions: { awards?: Record<string, unknown>[] } }>("GetPromotions");
  return (getPromotions.awards ?? []).map((award) => ({
    title: String(award.title ?? award.name ?? "Promotion"),
    description: typeof award.description === "string" ? award.description : null,
    expiresAt: typeof award.expiresAt === "string" ? award.expiresAt : null,
  }));
}
