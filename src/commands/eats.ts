import { z } from "zod";
import { field, lines, style, table } from "../cli/style.js";
import { eatsAccount, eatsCarts, eatsOrders } from "../uber/eats.js";
import { defineCommand, step, withProfile } from "./define.js";

export const eatsMe = defineCommand({
  name: "eats me",
  summary: "The Uber Eats account and its payment methods",
  risk: "read",
  aliases: ["eats"],
  input: {},
  examples: ["uber eats me"],
  async run(_input, context) {
    return { result: await eatsAccount(context.client()) };
  },
  render: (account) =>
    lines(
      `${account.signedIn ? style.green("●") : style.red("○")} ${style.bold(account.name ?? "Uber Eats")}`,
      field("email", account.email),
      field("payments", account.paymentMethods.map((method) => method.name).join(", ") || style.muted("none on Eats")),
    ),
});

export const eatsOrdersCommand = defineCommand({
  name: "eats orders",
  summary: "Active and past Uber Eats orders",
  risk: "read",
  input: { cursor: z.string().optional().describe("nextCursor from a previous page") },
  examples: ["uber eats orders"],
  async run(input, context) {
    const result = await eatsOrders(context.client(), input.cursor);
    return {
      result,
      next: result.nextCursor ? [step(withProfile(`uber eats orders --cursor ${result.nextCursor}`, context.profile), "Older orders")] : [],
    };
  },
  render: (result) =>
    lines(
      result.active.length > 0 ? style.green(`${result.active.length} active order(s)`) : null,
      result.past.length === 0
        ? style.muted("No past orders.")
        : table(result.past.map((order) => [style.muted(order.completedAt ? new Date(order.completedAt).toLocaleDateString() : ""), order.store ?? "", order.total !== null ? `${order.currency ?? ""} ${order.total.toFixed(2)}` : "", order.cancelled ? style.red("cancelled") : ""])),
    ),
});

export const eatsCartsCommand = defineCommand({
  name: "eats carts",
  summary: "Open Uber Eats carts",
  risk: "read",
  input: {},
  examples: ["uber eats carts"],
  async run(_input, context) {
    return { result: await eatsCarts(context.client()) };
  },
  render: (carts) => (carts.length === 0 ? style.muted("No open carts.") : JSON.stringify(carts, null, 2)),
});
