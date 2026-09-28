# uber

Uber for agents and humans: live fares, ride requests, trip history, receipts and Uber Eats, from the terminal or as an MCP server.

![uber rides estimate and request in the terminal, with a braille street map of Bogotá](assets/demo.gif)

```bash
uber login                                   # phone + SMS code, once
uber rides estimate --from home --to airport # live prices for every ride option
uber rides request --from home --to airport --product Comfort
uber rides request --confirm rq_…            # books only with the token, after a human says yes
uber rides status                            # driver, car, plate, PIN, ETA
```

## Why it is built this way

**HTTP first, browser when it has to be.** Every command speaks to the same GraphQL and RPC endpoints the Uber web apps use, with the session cookies of your own login, so reads take a few hundred milliseconds. [agent-browser](https://agent-browser.dev) is used for three things only: signing in, silently reconnecting a surface whose cookies expired, and Uber Eats, which sits behind a Cloudflare check that only a real browser passes.

**Secrets never touch disk in the clear.** The session is sealed with AES-256-GCM in `~/Library/Application Support/uber/profiles/<profile>/session.enc` (mode 0600, directory 0700). The key lives in the macOS Keychain (service `uber-cli`, account `<profile>/key`) and is written through `security -i` on stdin, so it never appears in a process list. Set `UBER_SESSION_KEY` (64 hex chars) on machines without a Keychain.

**Money needs a human.** `rides request` and `rides cancel` only preview until they receive the single-use `confirmToken` from that preview. The approved fare is a ceiling: if the quote expires and the price rises, nothing is booked and a fresh preview comes back. `--max-fare` refuses anything above a budget. Every attempt is written to an append-only audit log, and `uber killswitch on` freezes all money actions and revokes every pending token.

**One contract for agents.** Piped or with `--json`, every command prints exactly one envelope:

```json
{ "version": "1", "command": "rides estimate", "ok": true, "profile": "default", "result": { … }, "nextSteps": [{ "command": "uber rides request …", "reason": "…" }] }
```

Failures carry a stable `error.code`, a `hint` and `retryable`, and the exit code tells the class of failure without parsing text:

| exit | meaning |
|---|---|
| 0 | ok |
| 2 | usage: bad flag, missing input |
| 3 | auth: not signed in, expired, human check |
| 4 | not found |
| 5 | network |
| 6 | blocked: killswitch, bad or expired confirm token, `--max-fare` |
| 9 | Uber returned an error |

`uber schema --json` prints every command with its input as JSON Schema, its risk level and its MCP tool name.

## Install

```bash
npm i -g agent-browser && agent-browser install
npm i -g @crafter/uber-cli
uber doctor
```

## Sign in

A person at a terminal:

```bash
uber login            # a window opens; sign in with phone, code or QR
```

An agent, in two calls:

```bash
uber login --phone +573001234567   # Uber texts a code to the rider
uber login --code 1234             # the code the rider reads back
```

After the code, the CLI hops the single sign-on through each Uber surface (trips, ride booking, Eats) and seals the cookies. `uber auth status` shows which surfaces answer; `uber auth refresh` reconnects them from the saved browser profile without another SMS.

Use `--profile work` (or `UBER_PROFILE=work`) to keep several accounts side by side.

## Maps

`trips get`, `rides estimate`, `rides request` and `rides status` draw a map above their answer:

| terminal | what you see |
|---|---|
| Warp, iTerm2, WezTerm, VS Code, Kitty, Ghostty | the real image: for past trips, Uber's own route map, inline |
| anything else | a braille map: OpenStreetMap streets and water, named avenues, the route in Uber blue, pickup, dropoff, nearby cars and the driver |
| piped or `--json` | no map; results carry coordinates and the route as an encoded polyline instead |

`--map auto|image|braille|off` (or `UBER_MAP`) picks the style. Street data comes from [OpenFreeMap](https://openfreemap.org) vector tiles, cached in `~/Library/Caches/uber/tiles`, © OpenMapTiles, data from OpenStreetMap. `UBER_OUTPUT=human` keeps the full view when piping, e.g. into `less -R`.

The wordmark in `uber --help` is the official Uber logo ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Uber_logo_2018.svg), public domain as a text logo; still a trademark of Uber), pre-rendered by `bun run logo` so the CLI needs no image tools at runtime.

## Places

`--from` and `--to` take any of:

| input | example |
|---|---|
| a saved place label | `home`, `work`, `Gym` (see `uber places saved`) |
| coordinates | `4.6766,-74.0482` |
| a Google place id | `ChIJ0R6R-V-aP44RU4vk9byzHw4` |
| free text | `"Centro Comercial Andino"` |

Free text uses Uber's top match and echoes it back with up to three alternatives and their place ids, so an agent can check the match and correct it.

## Commands

| | |
|---|---|
| `login`, `logout`, `auth status`, `auth refresh` | session |
| `me`, `balance`, `promos` | account, payment methods, money owed, rewards |
| `rides estimate` | live fares and pickup times for every option |
| `rides request` | preview, then book with `--confirm` |
| `rides status`, `rides cancel` | the live ride; cancel previews first too |
| `places search`, `places saved` | pickup and dropoff search, saved places |
| `trips list`, `trips get`, `trips receipt` | history, details, itemized receipts (`--save receipt.html`) |
| `eats me`, `eats orders`, `eats carts` | Uber Eats account and orders |
| `doctor`, `audit`, `killswitch`, `schema` | health, money log, emergency stop, contract |

`uber <command> --help` shows flags and examples.

## MCP

```json
{
  "mcpServers": {
    "uber": { "command": "uber", "args": ["mcp"] }
  }
}
```

Every command above except `killswitch` and `schema` becomes a tool (`uber_rides_estimate`, `uber_rides_request`, …). Reads are annotated `readOnlyHint`, money tools `destructiveHint`, and the server instructions teach the preview, human approval, confirm protocol.

## Keeping up with Uber

The GraphQL documents in `src/graphql/documents.generated.ts` are extracted from Uber's live web bundles, fragments resolved:

```bash
bun run sync:operations
```

If Uber renames or removes an operation the CLI depends on, the script fails and names it.

## Limits

- Uber Eats has not operated in Colombia since 2020; its commands answer, but there is nothing to order there.
- Scheduled rides, multi-stop trips and business profiles are not wired into `rides request` yet.
- This uses Uber's private web APIs with your own session. They can change without notice, and automation may be subject to Uber's terms.

## Development

```bash
bun install     # or npm install
bun run dev -- rides estimate --from home --to work
bun test
bun run typecheck
bun run build
bun run demo    # re-record assets/demo.gif with vhs
```

MIT
