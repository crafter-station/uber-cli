export type Cookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

const nowSeconds = (): number => Date.now() / 1000;

export const isLive = (cookie: Cookie, at: number = nowSeconds()): boolean =>
  cookie.expires <= 0 || cookie.expires > at;

export function domainMatches(cookieDomain: string, host: string): boolean {
  if (!cookieDomain.startsWith(".")) return host === cookieDomain;
  const bare = cookieDomain.slice(1);
  return host === bare || host.endsWith(cookieDomain);
}

const pathMatches = (cookiePath: string, path: string): boolean =>
  path === cookiePath || path.startsWith(cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`);

export function cookieHeader(cookies: readonly Cookie[], url: URL): string {
  const chosen = new Map<string, Cookie>();
  for (const cookie of cookies) {
    if (!isLive(cookie) || !domainMatches(cookie.domain, url.hostname) || !pathMatches(cookie.path || "/", url.pathname)) {
      continue;
    }
    const current = chosen.get(cookie.name);
    if (!current || cookie.path.length > current.path.length || cookie.domain.length > current.domain.length) {
      chosen.set(cookie.name, cookie);
    }
  }
  return [...chosen.values()].map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function parseSetCookie(header: string, host: string): Cookie | null {
  const [pair = "", ...attributes] = header.split(";").map((part) => part.trim());
  const separator = pair.indexOf("=");
  if (separator <= 0) return null;
  const cookie: Cookie = {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    domain: host,
    path: "/",
    expires: -1,
  };
  for (const attribute of attributes) {
    const [rawKey = "", ...rest] = attribute.split("=");
    const key = rawKey.toLowerCase();
    const value = rest.join("=");
    if (key === "domain" && value) cookie.domain = `.${value.replace(/^\./, "")}`;
    else if (key === "path" && value) cookie.path = value;
    else if (key === "max-age") cookie.expires = nowSeconds() + Number(value);
    else if (key === "expires" && cookie.expires === -1) cookie.expires = Date.parse(value) / 1000 || -1;
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "secure") cookie.secure = true;
    else if (key === "samesite") cookie.sameSite = value;
  }
  return cookie;
}

const identity = (cookie: Cookie): string => `${cookie.domain}|${cookie.path}|${cookie.name}`;

export function mergeCookies(base: readonly Cookie[], updates: readonly Cookie[]): Cookie[] {
  const merged = new Map(base.map((cookie) => [identity(cookie), cookie]));
  for (const cookie of updates) {
    if (isLive(cookie)) merged.set(identity(cookie), cookie);
    else merged.delete(identity(cookie));
  }
  return [...merged.values()];
}

export function absorbSetCookies(base: readonly Cookie[], setCookies: readonly string[], host: string): Cookie[] {
  const updates = setCookies.map((header) => parseSetCookie(header, host)).filter((cookie) => cookie !== null);
  return updates.length > 0 ? mergeCookies(base, updates) : [...base];
}

export const isUberCookie = (cookie: Cookie): boolean => /(^|\.)(uber|ubereats)\.com$/.test(cookie.domain);
