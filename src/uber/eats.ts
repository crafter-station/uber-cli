import type { UberClient } from "./client.js";

type RawEatsUser = {
  uuid?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  isLoggedIn?: boolean;
  hasConfirmedMobile?: boolean;
  paymentProfiles?: { paymentProfiles?: { uuid: string; displayName?: string; tokenType?: string }[] };
};

export type EatsAccount = {
  signedIn: boolean;
  name: string | null;
  email: string | null;
  paymentMethods: { uuid: string; name: string }[];
};

export async function eatsAccount(client: UberClient): Promise<EatsAccount> {
  const user = await client.eats<RawEatsUser>("getUserV1");
  return {
    signedIn: user.isLoggedIn === true,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
    email: user.email ?? null,
    paymentMethods: (user.paymentProfiles?.paymentProfiles ?? []).map((profile) => ({
      uuid: profile.uuid,
      name: profile.displayName ?? profile.tokenType ?? "Payment method",
    })),
  };
}

type RawOrder = {
  baseEaterOrder?: { uuid?: string; completedAt?: string; isCancelled?: boolean };
  storeInfo?: { title?: string };
  fareInfo?: { totalPrice?: number; currencyCode?: string };
};

export type EatsOrder = {
  uuid: string;
  store: string | null;
  total: number | null;
  currency: string | null;
  completedAt: string | null;
  cancelled: boolean;
};

export type EatsOrders = { active: unknown[]; past: EatsOrder[]; nextCursor: string | null };

export async function eatsOrders(client: UberClient, cursor?: string): Promise<EatsOrders> {
  const [active, past] = await Promise.all([
    client.eats<{ orders?: unknown[] }>("getActiveOrdersV1"),
    client.eats<{
      ordersMap?: Record<string, RawOrder>;
      orderUuids?: string[];
      paginationData?: { nextCursor?: string };
    }>("getPastOrdersV1", { lastWorkflowUUID: cursor ?? "" }),
  ]);
  const orders = (past.orderUuids ?? []).map((uuid) => {
    const order = past.ordersMap?.[uuid];
    return {
      uuid,
      store: order?.storeInfo?.title ?? null,
      total: typeof order?.fareInfo?.totalPrice === "number" ? order.fareInfo.totalPrice / 100 : null,
      currency: order?.fareInfo?.currencyCode ?? null,
      completedAt: order?.baseEaterOrder?.completedAt ?? null,
      cancelled: order?.baseEaterOrder?.isCancelled ?? false,
    };
  });
  return { active: active.orders ?? [], past: orders, nextCursor: past.paginationData?.nextCursor || null };
}

export async function eatsCarts(client: UberClient): Promise<unknown[]> {
  const data = await client.eats<{ cartsView?: { carts?: unknown[] } }>("getCartsViewForEaterUuidV1");
  return data.cartsView?.carts ?? [];
}
