import { rmSync } from "node:fs";
import { z } from "zod";
import { UberError } from "../app/errors.js";
import { browserProfileDir } from "../app/paths.js";
import { Browser } from "../browser/agent-browser.js";
import { completeLogin, type LoginResult, silentRefresh, startLogin, submitCode, waitForHuman } from "../browser/login.js";
import { clock, field, lines, style, table } from "../cli/style.js";
import { banner } from "../cli/visual.js";
import { type Account, forgetSession, type KeySource, loadSession, resolveKey } from "../session/vault.js";
import { browserFetch } from "../browser/transport.js";
import { getAccount, toStoredAccount } from "../uber/account.js";
import { UberClient } from "../uber/client.js";
import { SURFACE_NAMES, SURFACES, type SurfaceName } from "../uber/surfaces.js";
import { defineCommand, type Outcome, step, withProfile } from "./define.js";

type LoginOutcome =
  | ({ status: "signed-in" } & LoginResult)
  | { status: "code-sent"; digits: number; prompt: string | null }
  | { status: "password-required" };

const renderLogin = (result: LoginOutcome): string => {
  if (result.status === "code-sent") {
    return `${style.green("✓")} Uber sent a ${result.digits}-digit code. ${style.muted(result.prompt ?? "")}`;
  }
  if (result.status === "password-required") return `${style.yellow("!")} Uber wants the account password. Run ${style.bold("uber login")} to finish in the window.`;
  return lines(
    banner(),
    "",
    `${style.green("✓")} Signed in as ${style.bold(result.account.name)}`,
    field("phone", result.account.phone),
    field("email", result.account.email),
    field("surfaces", SURFACE_NAMES.map((name) => `${name} ${result.surfaces[name] === "signed-in" ? style.green("●") : style.red("○")}`).join("  ")),
    field("key", `${result.keyStoredIn} ${style.muted(`(${result.cookies} cookies, AES-256-GCM)`)}`),
  );
};

export const login = defineCommand({
  name: "login",
  summary: "Sign in to Uber with a phone number and SMS code",
  guidance:
    "Two steps for agents: call with `phone` (Uber texts a code to the rider), ask the human for the code, then call again with `code`. With neither, a window opens for the human to sign in by hand.",
  risk: "auth",
  input: {
    phone: z.string().min(5).optional().describe("Phone number with country code (+57…) or account email"),
    code: z.string().regex(/^\d{4,8}$/).optional().describe("The code Uber texted, from the previous step"),
    wait: z.coerce.number().int().min(30).max(900).default(300).describe("Seconds to wait for a manual sign-in"),
  },
  examples: ["uber login", "uber login --phone +573001234567", "uber login --code 1234"],
  async run(input, context) {
    if (input.phone && input.code) throw new UberError("usage", "Pass --phone first, then --code in a second call.");

    const browser = Browser.require(context.profile, { headed: input.phone || input.code ? context.headed : true });
    const again = (flags: string) => withProfile(`uber login ${flags}`, context.profile);

    if (input.code) {
      context.progress("Checking the code…");
      await submitCode(browser, input.code);
      context.progress("Signed in. Connecting rides, trips and Eats…");
      const result = await completeLogin(browser, context.profile);
      return { result: { status: "signed-in" as const, ...result }, next: [step(withProfile("uber me", context.profile), "See the account")] };
    }

    if (input.phone) {
      context.progress("Opening Uber sign-in…");
      const started = await startLogin(browser, input.phone);
      if (started.status === "code-sent") {
        return {
          result: started,
          next: [step(again(`--code <${started.digits}-digit code>`), "Ask the rider for the code Uber just texted")],
        };
      }
      if (started.status === "password-required") return { result: started, next: [step("uber login", "Finish in the window")] };
      context.progress("Already signed in. Connecting rides, trips and Eats…");
      return { result: { status: "signed-in" as const, ...(await completeLogin(browser, context.profile)) } };
    }

    if (!context.interactive) {
      throw new UberError("usage", "Pass --phone to sign in without a terminal.", "e.g. `uber login --phone +573001234567`, then `uber login --code 1234`.");
    }
    context.progress("A window is opening. Sign in there (phone, code, or QR); this terminal follows along.");
    await waitForHuman(browser, input.wait * 1000);
    context.progress("Signed in. Connecting rides, trips and Eats…");
    return { result: { status: "signed-in" as const, ...(await completeLogin(browser, context.profile)) } };
  },
  render: renderLogin,
});

export const logout = defineCommand({
  name: "logout",
  summary: "Forget the stored session (and optionally the browser profile)",
  risk: "auth",
  input: {
    browser: z.boolean().default(false).describe("Also delete the persistent browser profile used for silent refresh"),
  },
  examples: ["uber logout", "uber logout --browser"],
  async run(input, context) {
    new Browser(context.profile, { headed: false }).close();
    forgetSession(context.profile);
    if (input.browser) rmSync(browserProfileDir(context.profile), { recursive: true, force: true });
    return { result: { signedOut: true, browserProfileRemoved: input.browser } };
  },
  render: (result) =>
    `${style.green("✓")} Signed out${result.browserProfileRemoved ? " and removed the browser profile" : ""}.`,
});

type SurfaceCheck = { surface: SurfaceName; label: string; ok: boolean; detail: string | null };

type AuthStatus = {
  signedIn: boolean;
  profile: string;
  account: Account | null;
  keyStoredIn: KeySource | null;
  savedAt: string | null;
  surfaces: SurfaceCheck[];
};

async function checkSurface(client: UberClient, surface: SurfaceName): Promise<SurfaceCheck> {
  const label = SURFACES[surface].label;
  try {
    if (surface === "riders") await client.graphql("GetArrears", { enableNewArrearFlow: true });
    if (surface === "rides") await client.graphql("RiderCompletedTripsCount");
    if (surface === "eats") {
      const user = await client.eats<{ isLoggedIn?: boolean }>("getUserV1");
      if (!user.isLoggedIn) return { surface, label, ok: false, detail: "signed out" };
    }
    return { surface, label, ok: true, detail: null };
  } catch (error) {
    return { surface, label, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export const authStatus = defineCommand({
  name: "auth status",
  summary: "Show the account, where the session key lives, and which Uber surfaces answer",
  risk: "read",
  aliases: ["auth", "status", "whoami"],
  input: {},
  examples: ["uber auth status"],
  async run(_input, context): Promise<Outcome<AuthStatus>> {
    const session = loadSession(context.profile);
    const key = resolveKey(context.profile);
    if (!session) {
      return {
        result: { signedIn: false, profile: context.profile, account: null, keyStoredIn: key?.source ?? null, savedAt: null, surfaces: [] },
        next: [step(withProfile("uber login", context.profile), "Sign in")],
      };
    }
    const client = UberClient.open(context.profile, { browserFetch: browserFetch(context.profile) });
    const surfaces = await Promise.all(SURFACE_NAMES.map((surface) => checkSurface(client, surface)));
    if (!client.account && surfaces[0]?.ok) client.attachAccount(toStoredAccount(await getAccount(client)));
    client.persist();
    const healthy = surfaces.every((check) => check.ok);
    return {
      result: {
        signedIn: surfaces.some((check) => check.ok),
        profile: context.profile,
        account: client.account ?? null,
        keyStoredIn: key?.source ?? null,
        savedAt: session.savedAt,
        surfaces,
      },
      next: healthy ? [] : [step(withProfile("uber auth refresh", context.profile), "Reconnect the surfaces that stopped answering")],
    };
  },
  render: (result) =>
    result.signedIn || result.account
      ? lines(
          `${style.bold(result.account?.name ?? "Uber account")} ${style.muted(`· profile ${result.profile}`)}`,
          field("phone", result.account?.phone),
          field("email", result.account?.email),
          field("key", result.keyStoredIn),
          field("saved", result.savedAt ? `${new Date(result.savedAt).toLocaleDateString()} ${clock(result.savedAt)}` : null),
          "",
          table(result.surfaces.map((check) => [check.ok ? style.green("●") : style.red("○"), check.surface, style.muted(check.detail ?? check.label)])),
        )
      : `${style.yellow("○")} Not signed in ${style.muted(`(profile ${result.profile})`)}`,
});

export const authRefresh = defineCommand({
  name: "auth refresh",
  summary: "Silently reconnect every surface using the saved browser profile, no SMS needed",
  risk: "auth",
  input: {},
  examples: ["uber auth refresh"],
  async run(_input, context) {
    const results: { surface: SurfaceName; ok: boolean }[] = [];
    for (const surface of SURFACE_NAMES) {
      context.progress(`Reconnecting ${surface}…`);
      results.push({ surface, ok: (await silentRefresh(context.profile, surface)) !== null });
    }
    const failed = results.filter((entry) => !entry.ok);
    return {
      result: { surfaces: results },
      next: failed.length > 0 ? [step(withProfile("uber login", context.profile), "The browser session expired too; sign in again")] : [],
    };
  },
  render: (result) => table(result.surfaces.map((entry) => [entry.ok ? style.green("●") : style.red("○"), entry.surface])),
});
