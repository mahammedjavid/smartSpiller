# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Smart Splitter — photograph a restaurant bill, share a link, friends tap what they ate, everyone
gets their exact fair share with a UPI payment link. `REQUIREMENTS.md` is the original product
spec and still governs behaviour (requirement IDs like `FR-SPLIT-1` appear in code comments), but
note it describes a Supabase/auth design that was **deliberately replaced** — see Architecture.

## Commands

```bash
# frontend (Angular 22, run from frontend/)
npm start                                    # dev server on :4300
npm run build                                # also the typecheck; must stay clean
npm test                                     # vitest, via `ng test`
npx ng test --watch=false --filter="largestRemainder"        # one suite/test by name regex
npx ng test --watch=false --include=src/app/core/upi.spec.ts # one file

# backend (Express 5 + TS, ESM, run from backend/)
npm run dev          # tsx watch on :8080
npm run typecheck
npm run build && npm start
npm test             # node --test; no backend test files exist yet, so this passes vacuously
```

Ports: the frontend serves on **4300**, set in `angular.json`, because 4200 is taken by an
unrelated project on this machine. `CORS_ORIGINS` in `backend/.env` must list whichever port the
frontend actually uses, or `/api/scan` fails with an opaque browser CORS error.

The only credential is `GEMINI_API_KEY` in `backend/.env`, and it only affects scanning — every
other flow (manual entry, joining, claiming, paying) runs with no configuration at all.

## Architecture

There is **no database service, no auth provider and no accounts**. An earlier version used
Supabase with RLS, email sign-in and anonymous guests; it was removed on purpose because the
setup cost outweighed what it bought. Don't reintroduce a cloud dependency without being asked.

```
Angular 22  ──POST/PUT/DELETE /api/bills/…──▶  Express 5 + node:sqlite
            ◀──GET /api/bills/:code/stream───  (SSE: full room state, pushed)
                                                    │
                                                    └─ /api/scan → Gemini
```

### One state shape, one update path

Every endpoint — reads, writes, and every SSE frame — returns the identical object
`{ bill, items, participants, claims }` (`billState()` in `backend/src/db.ts`). The client never
patches; it replaces. Keep it that way: a new endpoint that returns a partial shape breaks the
invariant that the bill room has exactly one way to apply state.

### Real-time

`backend/src/events.ts` holds a `Map<billCode, Set<Response>>`. Any mutation calls `broadcast()`,
which serialises the room and writes it to each open SSE response. There is no WebSocket, no
subscription library, and no client reconnect logic — `EventSource` reconnects itself. The bill
room's `refresh()` is only the manual fallback behind the "reconnecting" chip.

### Identity is capability-based

No accounts. `localStorage` holds `ss:owner:<code>` (returned once from `POST /bills`) and
`ss:me:<code>` (returned from join). The owner token goes out in an `X-Owner-Token` header on
every request; the server checks it only on owner-only routes (`requireOwner` in
`routes/bills.ts`). Possessing the share link is the entire authorisation model — anyone with it
can claim as anyone. That is an accepted trade, documented in the README, not an oversight.

### One person per name per bill

Joining matches on a case-insensitive, trimmed display name before creating anyone
(`routes/bills.ts`). Without it, rejoining from a second device or a cleared browser produced
"Vaishali" *and* "vaishali" as separate people, splitting one person's claims across two rows.
The same check guards the payer adding an offline friend.

### Money

Every amount is an **integer number of paise**. Rupees exist only in form inputs and in what
Gemini returns, and are converted at the boundary (`core/money.ts`, `backend/src/lib/reconcile.ts`).

`computeSplit()` guarantees `Σ person_totals + unclaimed_total === grand_total`, to the paisa, for
any input. That invariant is asserted in every scenario in `split.spec.ts` via `expectAddsUp()`.
**Any change to `split.ts` or `largestRemainder()` must keep those tests green** — they encode the
worked example and rounding rules from `REQUIREMENTS.md` §8, including ties going to whoever
joined earlier, negative net charges, and the unclaimed bucket carrying its own share of tax.

`recalculateTotals()` in `db.ts` keeps the stored subtotal and total consistent with the items on
every write, so the two never drift.

### Bill lifecycle

`draft → open → settled`. The Review screen is a mandatory trust gate: scanned data always passes
through it before anyone can claim, and nothing is joinable or claimable while a bill is `draft`
(`requireOpen` in `routes/bills.ts`).

### Scan contract

`ScanResponse` in `backend/src/lib/scanSchema.ts` and `ScanResult` in
`frontend/src/app/core/models.ts` are the same shape and must change together. `reconcile.ts`
converts Gemini's rupees to paise and makes the bill internally consistent, turning anything it
had to adjust into a user-visible `warnings[]` entry rather than a silent fix. The item list wins
over a stated subtotal; a stated-total gap within ₹1 is absorbed into round-off, a larger one
becomes a warning. The photo is never written to disk.

## Frontend conventions

Angular 22, standalone components, **zoneless** change detection, signals throughout, `@if`/`@for`
control flow, `ChangeDetectionStrategy.OnPush`, one file per page (template and styles inline).

**The zoneless trap that has already bitten this codebase twice:**

1. A `computed()` that reads a plain class field never re-evaluates. `review.ts` originally bound
   `payerName`/`payerUpiId` as plain fields, so "Open for splitting" stayed disabled forever.
   They are signals now, bound with `[ngModel]` + `(ngModelChange)="x.set($event)"`.
2. `[(ngModel)]` on an object **inside an array** mutates in place without changing the array
   reference, so signals don't fire either. `review.ts` bumps a `revision` signal from `touch()`
   on every `ngModelChange` to drive the computed totals. Keep that pattern if you add fields.

Every network call needs a loading state, a human-readable error and a retry path (`NFR-3`) — no
blank screens, no raw errors. User-facing copy lives in the `ApiError` class in
`backend/src/lib/errors.ts`; add new cases there rather than surfacing driver messages.

Claiming is optimistic: the click updates local state immediately, and the server's push is
authoritative. A failed mutation calls `refresh()` to undo the optimistic change.

## Not built

Trip mode (`FR-TRIP-*`, P2 in the spec): multiple bills, net balances, minimum-payment settlement.
Payments are self-reported — no gateway, no verification — and the UI says so.
