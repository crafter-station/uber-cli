---
name: uber
description: Use when the user wants Uber prices, to book or cancel an Uber ride, to check a ride in progress, or to look up past trips, receipts or Uber Eats orders. Drives the `uber` CLI (or its MCP tools).
---

# Uber

The `uber` CLI answers in one JSON envelope when piped. Read `ok`, `result`, `error.code`, `error.hint` and follow `nextSteps`.

## First, the session

```bash
uber auth status --json
```

If it is not signed in, or a command exits 3:

1. `uber login --phone <+country number>`: Uber texts a code to the rider.
2. Ask the rider for the code. Never guess it.
3. `uber login --code <code>`.

If a surface shows as expired, try `uber auth refresh` before asking for a new SMS.

## Prices

```bash
uber places saved --json
uber rides estimate --from <place> --to <place> --json
```

`<place>` is a saved label, `lat,lng`, a Google place id, or text. For text, check `result.pickup` and `result.dropoff`: if the match is wrong, rerun with an id from `alternatives`.

## Booking: the rider decides

```bash
uber rides request --from <place> --to <place> --product "<option name>" --json
```

This is only a preview. Show the rider the ride, fare, pickup, dropoff and payment, and wait for an explicit yes. Then:

```bash
uber rides request --confirm <confirmToken> --json
```

- Never pass `--confirm` without a yes for that exact preview.
- If the confirm fails with `blocked.confirm` because the price rose, show the new price and ask again.
- Use `--max-fare <amount>` when the rider gave a budget.

Cancelling works the same way: `uber rides cancel` previews, `--confirm` cancels. Say that Uber may charge a fee once a driver is on the way.

## During a ride

`uber rides status --json` gives the driver, car, plate, pickup PIN and ETA.

## History

`uber trips list`, `uber trips get <uuid>`, `uber trips receipt <uuid>`, `uber balance`, `uber me`.

## Never

- Never confirm a money action on your own initiative or in a test.
- Never read, print or move the session files or the Keychain key.
- If `uber killswitch` is on, do not turn it off; tell the rider.
