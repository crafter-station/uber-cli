import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { selectProfile } from "../src/app/profile.js";
import { cookieHeader } from "../src/session/jar.js";
import { loadSession } from "../src/session/vault.js";
import { USER_AGENT } from "../src/uber/client.js";

const PAGES = ["https://m.uber.com/go/home", "https://riders.uber.com/trips"];

const WANTED = [
  "Activities",
  "CancellationInformation",
  "CurrentUserRidersWeb",
  "GetArrears",
  "GetPromotions",
  "GetReceipt",
  "GetStatus",
  "GetTrip",
  "GetUpcomingTrip",
  "Products",
  "PudoLocationSearch",
  "PudoResolveLocationPudoFragment",
  "RatingDetails",
  "RiderCompletedTripsCount",
  "SavedPlaces",
  "TripCancel",
  "TripRequest",
] as const;

const CONCURRENCY = 24;

const session = loadSession(selectProfile(process.env.UBER_PROFILE));
if (!session) throw new Error("Sign in first: the app pages only serve their bundles to a session.");

async function text(url: string): Promise<string> {
  const target = new URL(url);
  const response = await fetch(target, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,*/*", cookie: cookieHeader(session?.cookies ?? [], target) },
  });
  return response.ok ? response.text() : "";
}

async function chunkUrls(page: string): Promise<string[]> {
  const html = await text(page);
  const scripts = [...html.matchAll(/https:\/\/[a-z0-9.]+\/[a-z0-9-]+\/client-[a-z0-9-]+\.js/g)].map((match) => match[0]);
  const runtimes = [...new Set(scripts.filter((url) => url.includes("client-runtime-")))];
  const chunks = await Promise.all(
    runtimes.map(async (runtime) => {
      const base = runtime.slice(0, runtime.lastIndexOf("/") + 1);
      const map = [...(await text(runtime)).matchAll(/(\d+):"([a-f0-9]{16})"/g)];
      return map.map(([, id, hash]) => `${base}client-${id}-${hash}.js`);
    }),
  );
  return [...new Set([...scripts, ...chunks.flat()])];
}

async function fetchAll(urls: string[]): Promise<string[]> {
  const results: string[] = [];
  for (let index = 0; index < urls.length; index += CONCURRENCY) {
    results.push(...(await Promise.all(urls.slice(index, index + CONCURRENCY).map(text))));
  }
  return results;
}

function balancedBlock(source: string, start: number): string | null {
  const open = source.indexOf("{", start);
  if (open === -1) return null;
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    const char = source[index];
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return source.slice(start, index + 1);
    else if (char === "`") return null;
  }
  return null;
}

function definitions(sources: string[], pattern: RegExp): Map<string, string> {
  const found = new Map<string, string>();
  for (const source of sources) {
    for (const match of source.matchAll(pattern)) {
      const name = match[2] ?? "";
      if (found.has(name)) continue;
      const block = balancedBlock(source, match.index ?? 0);
      if (block) found.set(name, block.replace(/\\n/g, "\n"));
    }
  }
  return found;
}

function withFragments(document: string, fragments: Map<string, string>): string {
  const included = new Set<string>();
  const queue = [document];
  while (queue.length > 0) {
    for (const [, name] of (queue.pop() ?? "").matchAll(/\.\.\.([A-Za-z0-9_]+)/g)) {
      if (!name || included.has(name) || !fragments.has(name)) continue;
      included.add(name);
      queue.push(fragments.get(name) ?? "");
    }
  }
  return [document, ...[...included].sort().map((name) => fragments.get(name))].join("\n");
}

const minify = (document: string): string => document.replace(/\s+/g, " ").trim();

const urls = [...new Set((await Promise.all(PAGES.map(chunkUrls))).flat())];
const bundles = (await fetchAll(urls)).filter((source) => /\b(query|mutation|fragment)\s/.test(source));

const operations = definitions(bundles, /(query|mutation)\s+([A-Z][A-Za-z0-9_]+)\s*[({]/g);
const fragments = definitions(bundles, /(fragment)\s+([A-Za-z0-9_]+)\s+on\s+/g);

const missing = WANTED.filter((name) => !operations.has(name));
if (missing.length > 0) throw new Error(`Missing from Uber's bundles: ${missing.join(", ")}`);

const entries = WANTED.map(
  (name) => `  ${name}: ${JSON.stringify(minify(withFragments(operations.get(name) ?? "", fragments)))},`,
);
writeFileSync(
  join(import.meta.dir, "..", "src", "graphql", "documents.generated.ts"),
  `export const DOCUMENTS = {\n${entries.join("\n")}\n} as const;\n\nexport type OperationName = keyof typeof DOCUMENTS;\n`,
);
console.log(`${WANTED.length} operations synced from ${urls.length} chunks (${operations.size} operations, ${fragments.size} fragments seen)`);
