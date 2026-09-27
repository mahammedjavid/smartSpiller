# Smart Splitter

Photograph a restaurant bill, share a link, let every friend tap the dishes they had, and give
each person their exact fair share — tax, service charge and discounts included — with a one-tap
UPI payment link to whoever paid.

**No accounts. No cloud services. No sign-up for anyone.** Clone it and run two commands.

---

## Run it

```bash
cd backend  && npm install && npm run dev     # :8080
cd frontend && npm install && npm start       # :4300
```

The only configuration that matters is a Gemini API key in `backend/.env`, and that is only
needed to scan a photo — manual entry works without it. Get a free one at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey) (no credit card).

```bash
cd backend && cp .env.example .env    # then paste GEMINI_API_KEY
```

---

## Architecture

```
Angular 22 (no auth, no database client)
   │  POST/PUT/DELETE /api/bills/…        ← mutations
   │  GET  /api/bills/:code/stream (SSE)  ← live updates, pushed
   ▼
Express 5  +  node:sqlite   (built into Node 24 — one file, zero dependencies)
   │
   └─ POST /api/scan → Gemini    (photo in memory, never stored)
```

**Real-time is one file.** Every mutation writes to SQLite and then pushes the whole room state
to every open `EventSource` for that bill (`backend/src/events.ts`, ~50 lines). There is no
WebSocket upgrade, no subscription library, and no reconnect logic to maintain — the browser
reconnects `EventSource` by itself. The client's only update path is "replace state with what
the server just sent."

**The split calculation is a pure function in the frontend** (`frontend/src/app/core/split.ts`),
covered by unit tests. It has no idea where the data came from.

---

## Identity without accounts

The share link **is** the credential — the same model as a "anyone with the link" document.

| What you hold (in `localStorage`) | What it gets you |
|---|---|
| `ss:owner:<code>` — the owner token, returned once when you create a bill | The payer's controls: edit the bill, confirm payments, settle |
| `ss:me:<code>` — your participant id, returned when you join | You are that person; your claims are yours |

Refreshing keeps you the same person. A different device makes you a new person. Nobody ever
sees a sign-up form.

**What this deliberately gives up:** anyone with the link can claim as anyone and edit the bill.
For a group splitting dinner that is the right trade — it is what makes zero-friction joining
possible. Don't post the link publicly.

---

## How the money maths works

Every amount is an **integer number of paise**. No floating-point money anywhere.

1. **Item shares.** Each item's price is divided among its claimants in proportion to their
   shares, using the **largest remainder method**, so the pieces add up exactly. Ties go to
   whoever joined earlier.
2. **Quantity lines take units.** `Mutton biriyani ×4 — ₹1600` is four things: tapping it claims
   one (₹400) and leaves three for everyone else. If more shares are claimed than there are
   units — one dish three people picked — the line splits between them proportionally instead.
3. **Unclaimed items and unclaimed units** go to their own bucket, shown to the payer.
4. **Charges** (`tax + service charge + tip − discount + round off`) are split in proportion to
   each person's item subtotal, with the unclaimed bucket counted as one more weight — so
   unclaimed food carries its own share of tax. Largest remainder again.
5. **Totals.** `person_total = item_subtotal + charge_share`, and
   `Σ person_totals + unclaimed_total = grand_total`, to the paisa, always.

That last line is asserted in every scenario in
[`frontend/src/app/core/split.spec.ts`](./frontend/src/app/core/split.spec.ts) — the worked
example from the PRD, the rounding case, all-unclaimed, a discount larger than the tax, a
negative round-off, a zero-item bill, a single participant, multi-quantity share stepping, and a
real restaurant bill (Bhagini, ₹3,150) worked end to end.

```bash
cd frontend && npm test
```

---

## Screens

| Route | Screen | Who |
|---|---|---|
| `/` | Scan a bill or enter it manually, plus recent bills | Payer |
| `/b/:code/review` | Check and edit items, charges, UPI ID | Payer |
| `/b/:code` | Bill room — live claiming, payments | Both |
| `/j/:code` | Join by name | Guest |

---

## API

All responses are the same object — `{ bill, items, participants, claims }` — so the client
has exactly one way to apply state.

| | |
|---|---|
| `GET /api/health` | `{ ok, time }` |
| `POST /api/scan` | `multipart/form-data` with `image` → extracted bill in paise, plus `warnings[]` |
| `POST /api/bills` | Create a draft → `{ code, ownerToken, ... }` |
| `GET /api/bills/:code` | The room |
| `GET /api/bills/:code/stream` | SSE — full room state on connect and on every change |
| `PUT /api/bills/:code` | Save the review (owner) |
| `POST /api/bills/:code/open` \| `/settle` | Publish / close (owner) |
| `POST /api/bills/:code/join` | `{ name }` → `{ participantId }` |
| `PUT` \| `DELETE /api/bills/:code/claims` | Claim / un-claim |
| `POST /api/bills/:code/leftovers` | Split unclaimed items equally (owner) |
| `POST /api/bills/:code/payment` | Mark paid; confirming needs the owner token |

The owner token travels in an `X-Owner-Token` header. Errors are always
`{ "error": { "code": "...", "message": "..." } }` with a message that is safe to show a user.

---

## Deploying

**Frontend → Vercel.** Deploys from `frontend/`; `vercel.json` sets the build command, the
`dist/frontend/browser` output directory and the SPA rewrite.

**Backend → Render.** `backend/render.yaml` describes a free web service with `/api/health` as
its health check. Set `GEMINI_API_KEY` and `CORS_ORIGINS` (your Vercel origin) in the dashboard.

Order matters, because each side needs the other's URL:

1. Deploy the backend, note its `https://….onrender.com` URL.
2. Put that URL in `apiBaseUrl` in `frontend/src/environments/environment.prod.ts`, commit.
3. Deploy the frontend, note its origin.
4. Set `CORS_ORIGINS` on Render to that origin and redeploy the backend.

`appBaseUrl` needs no configuring — the share link and QR code use `location.origin`, so they
always point at wherever the app is actually served.

The frontend calls the backend **directly rather than through a Vercel proxy**, because the bill
room holds an open Server-Sent Events stream and CDN proxies tend to buffer or time those out.
That is why `CORS_ORIGINS` has to be right.

> ### Bills do not survive on Render's free tier
>
> A free Render service [cannot attach a persistent disk](https://render.com/docs/disks) and its
> filesystem is ephemeral, so `data/smart-splitter.db` is wiped on every restart, redeploy, and
> wake from sleep (free instances sleep after ~15 minutes idle). A bill created during a demo
> works completely — scanning, live claiming, UPI — it just will not be there tomorrow.
>
> To make bills durable, pick one: a paid Render instance with a disk; Fly.io, whose free tier
> does include volumes, keeping SQLite unchanged; or move `backend/src/db.ts` to Postgres.

> Free instances also sleep. The app hits `/api/health` on load and shows "Waking up the server…"
> if a scan takes more than five seconds.

---

## Known limits

- **Payments are self-reported.** No gateway, no verification — "I've paid" and "Confirm" are
  trust-based, and the UI says so rather than implying otherwise.
- **Some UPI apps** refuse intent links to personal VPAs or cap the amount. Every pay screen
  also shows a QR code and a **Copy UPI ID** fallback.
- **One server owns the data.** Storage is local SQLite — a single file at
  `backend/data/smart-splitter.db`, set by `DATABASE_FILE`. Fine for a group, a team, or a demo.
  If you outgrow it, `backend/src/db.ts` is the only file that talks to the database.
- **Trip mode** (several bills, net balances, minimum-payment settlement) is designed in
  `REQUIREMENTS.md` but not built.
