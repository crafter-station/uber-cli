import { UberError } from "../app/errors.js";
import { DOCUMENTS, type OperationName } from "../graphql/documents.generated.js";
import type { BrowserFetch } from "../browser/transport.js";
import { isChallenge } from "../browser/transport.js";
import { absorbSetCookies, cookieHeader } from "../session/jar.js";
import { type Account, loadSession, type Session, saveSession } from "../session/vault.js";
import { OPERATION_SURFACE, SURFACES, type SurfaceName } from "./surfaces.js";

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export type Refresher = (profile: string, surface: SurfaceName) => Promise<Session | null>;

export type ClientOptions = { refresher?: Refresher; browserFetch?: BrowserFetch };

type GraphQLError = { message?: string; extensions?: { code?: string; title?: string; subtitle?: string } };
type GraphQLResponse<T> = { data?: T | null; errors?: GraphQLError[] };
type EatsResponse<T> = { status?: string; data?: T & { code?: number; message?: string; meta?: { code?: string } } };

class SessionRejected extends Error {}

const TIMEOUT_MS = 20_000;

export class UberClient {
  private session: Session;
  private dirty = false;

  private constructor(
    readonly profile: string,
    session: Session,
    private readonly options: ClientOptions,
  ) {
    this.session = session;
  }

  static open(profile: string, options: ClientOptions = {}): UberClient {
    const session = loadSession(profile);
    if (!session || session.cookies.length === 0) {
      throw new UberError(
        "auth.missing",
        profile === "default" ? "Not signed in to Uber." : `Profile "${profile}" is not signed in.`,
        `Run \`uber login${profile === "default" ? "" : ` --profile ${profile}`}\`.`,
      );
    }
    return new UberClient(profile, session, options);
  }

  get account(): Account | undefined {
    return this.session.account;
  }

  attachAccount(account: Account): void {
    this.session = { ...this.session, account };
    this.dirty = true;
  }

  async graphql<T>(operation: OperationName, variables: Record<string, unknown> = {}): Promise<T> {
    const surface = OPERATION_SURFACE[operation];
    return this.withRefresh(surface, async () => {
      const response = await this.post(SURFACES[surface].endpoint, {
        operationName: operation,
        query: DOCUMENTS[operation],
        variables,
      });
      if (response.status === 401 || response.status === 403 || (surface === "riders" && response.status === 404)) {
        throw new SessionRejected();
      }
      const body = (await response.json()) as GraphQLResponse<T>;
      const errors = body.errors ?? [];
      if (errors.some((error) => error.extensions?.code === "unauthorized" || error.extensions?.code === "unauthenticated")) {
        throw new SessionRejected();
      }
      if (!body.data) {
        const first = errors[0];
        throw new UberError(
          "upstream",
          first?.extensions?.title ?? first?.message ?? `Uber returned no data for ${operation}.`,
          first?.extensions?.subtitle,
        );
      }
      return body.data;
    });
  }

  async eats<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
    return this.withRefresh("eats", async () => {
      const url = `${SURFACES.eats.endpoint}${endpoint}`;
      const response = await this.post(url, body);
      let status = response.status;
      let text = await response.text();
      if (isChallenge(status, text)) {
        if (!this.options.browserFetch) {
          throw new UberError("auth.challenge", "Uber Eats is behind a Cloudflare check that only a real browser passes.");
        }
        ({ status, body: text } = await this.options.browserFetch(url, body));
      }
      if (status === 401 || status === 403) throw new SessionRejected();
      const payload = JSON.parse(text) as EatsResponse<T>;
      if (payload.status === "success" && payload.data) return payload.data;
      if (payload.data?.code === 403 || payload.data?.meta?.code === "rtapi.forbidden") throw new SessionRejected();
      throw new UberError("upstream", payload.data?.message ?? `Uber Eats rejected ${endpoint}.`);
    });
  }

  persist(): void {
    if (!this.dirty) return;
    saveSession(this.profile, { ...this.session, savedAt: new Date().toISOString() });
    this.dirty = false;
  }

  private async withRefresh<T>(surface: SurfaceName, attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof SessionRejected)) throw error;
    }
    const refreshed = this.options.refresher ? await this.options.refresher(this.profile, surface) : null;
    if (refreshed) {
      this.session = refreshed;
      try {
        return await attempt();
      } catch (error) {
        if (!(error instanceof SessionRejected)) throw error;
      }
    }
    throw new UberError(
      "auth.expired",
      `The Uber session for ${SURFACES[surface].label.toLowerCase()} has expired.`,
      `Run \`uber login${this.profile === "default" ? "" : ` --profile ${this.profile}`}\`.`,
    );
  }

  private async post(url: string, body: unknown): Promise<Response> {
    const target = new URL(url);
    const response = await fetch(target, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-csrf-token": "x",
        origin: target.origin,
        referer: `${target.origin}/`,
        "user-agent": USER_AGENT,
        cookie: cookieHeader(this.session.cookies, target),
      },
      body: JSON.stringify(body),
    }).catch((error: unknown) => {
      throw new UberError(
        "network",
        error instanceof Error && error.name === "TimeoutError" ? "Uber took too long to answer." : "Could not reach Uber.",
        "Check the connection and retry.",
      );
    });
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      this.session = { ...this.session, cookies: absorbSetCookies(this.session.cookies, setCookies, target.hostname) };
      this.dirty = true;
    }
    if (response.status >= 500) throw new UberError("upstream", `Uber answered ${response.status}.`, "Retry in a moment.");
    return response;
  }
}
