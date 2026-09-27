# ProSplitter — Product Requirements Document

Version 1.0 · Hackathon build (≈2 hours) · Stack: Angular 22 · Node 24 + Express 5 · Supabase · Gemini (free tier)

---

## 1. One-line summary

Photograph a restaurant bill (or type it in), share a link, let every friend tap the dishes they had, and give each person their exact fair share — tax, service charge and discounts included — with a one-tap UPI payment link to whoever paid.

---

## 2. The problem

### 2.1 User
A group of 3–8 friends, classmates or colleagues who eat out, order in or travel together, where **one person pays the whole bill** and the rest owe them.

We design for two roles:

| Role | Who | What they need |
|---|---|---|
| **Payer (host)** | The person who paid the bill | Get the bill into the app fast, share it, get paid back without chasing anyone |
| **Guest** | Everyone else at the table | Find out exactly what they owe in seconds and pay without installing or signing up for anything |

### 2.2 Moment
The bill has just arrived at the table (or the delivery order just landed). One person pays. Then the awkward part begins: *"Who had the paneer? The naan was shared by four of us. How do we split GST and the service charge? Just divide by five?"*

### 2.3 Problem statement
When one person pays a group bill, splitting it fairly is slow, error-prone and socially awkward. People either split equally (unfair to light eaters), do rough mental maths (tax and service charge are almost always split wrong), or promise to "settle later" — which leaves the payer chasing people on WhatsApp for days. The information needed (the itemised bill, who ate what, the payer's UPI ID) exists at the table, but nothing connects it.

### 2.4 Why existing options fall short
- **Equal split** (calculator or Splitwise "split equally"): fast but unfair.
- **Splitwise itemised entry**: every item typed by hand, by one person, and everyone needs an account.
- **Mental maths / WhatsApp polls**: tax and service charge are ignored or split equally; errors cause arguments.

---

## 3. Ideal state

> One photo, thirty seconds of tapping, and everyone knows their exact, fair share and has paid it — without anyone doing maths, typing items, or chasing friends.

Concretely, once ProSplitter works:
1. The payer photographs the bill; items and prices appear in under ~10 seconds and can be corrected in place.
2. Friends scan a QR code or tap a link, type only their name, and tap what they ate. Nobody installs an app or creates an account.
3. Shared dishes split automatically between whoever claims them.
4. Tax, service charge, tip, discounts and round-off are split **in proportion to what each person ate**.
5. Every guest gets a one-tap UPI button (and QR code) with the payer's UPI ID and the exact amount pre-filled.
6. The payer sees, live, who has claimed, what is still unclaimed and who has paid.

---

## 4. Goals and non-goals

### Goals (this build)
- G1. Turn a bill photo into an editable, itemised list reliably, with a manual fallback.
- G2. Let guests join and claim items with zero sign-up friction.
- G3. Calculate fair shares correctly to the paisa, every time.
- G4. Generate working UPI payment links and QR codes.
- G5. Show live claim and payment status to everyone.
- G6. Ship a deployed, bug-free demo.

### Non-goals (this build)
- Actually moving money or verifying UPI payments (no payment gateway).
- Multi-currency.
- Native mobile apps (the web app is mobile-first instead).
- Storing bill photos (privacy: images are processed and discarded).

---

## 5. Priorities

| Priority | Meaning |
|---|---|
| **P0** | Must ship. The demo fails without it. |
| **P1** | Should ship if P0 is done and stable. |
| **P2** | Design and pitch it; build only with spare time. |

Rule for the team: **no P1 work starts until every P0 works end-to-end on a deployed URL on two phones.**

---

## 6. User flows

### 6.1 Payer flow
1. Opens the app → signs up / signs in (email + password).
2. Taps **New bill** → chooses **Scan bill** (camera / upload) or **Enter manually**.
3. (Scan) Uploads the photo → sees a loading state → lands on the **Review** screen with extracted items, taxes and totals, plus any warnings (e.g. "items don't add up to subtotal").
4. Edits, adds or deletes items; confirms tax / service charge / discount / tip / round-off.
5. Enters their display name and UPI ID (remembered for next time in their profile row or pre-filled from last bill).
6. Taps **Open for splitting** → lands in the **Bill room** with a QR code and share link.
7. Claims their own items (the payer is a participant too).
8. Optionally adds participants who don't have a phone and claims on their behalf.
9. Watches claims and payments arrive live; assigns or equally splits leftover items; confirms payments.
10. When everyone has paid, marks the bill **Settled**.

### 6.2 Guest flow
1. Scans the QR code or opens the link `/j/:code`.
2. Enters their name → joins (anonymous session is created silently).
3. Lands in the **Bill room**, taps the items they had (tap again to un-claim; stepper for quantity shares on multi-quantity items).
4. Sees their running total with a breakdown (items + share of tax/service/tip − discount).
5. Taps **Pay ₹X via UPI** → UPI app opens with everything pre-filled; or scans the QR on the payer's screen.
6. Taps **I've paid** → payer sees it and confirms.

---

## 7. Functional requirements

Each requirement has an ID, priority and acceptance criteria (AC). Use the IDs in commit messages and in the demo checklist.

### 7.1 Authentication and sessions

**FR-AUTH-1 (P0) Payer sign-up / sign-in**
Email + password via Supabase Auth. Email confirmation is disabled for the hackathon (Supabase's built-in email sender is heavily rate-limited).
- AC1: A new user can sign up and is signed in immediately.
- AC2: Refreshing the page keeps the user signed in.
- AC3: Sign-out returns to the landing page.
- AC4: Anonymous (guest) users cannot create bills — enforced by the database, not just the UI.

**FR-AUTH-2 (P0) Guest anonymous join**
Guests are signed in with Supabase anonymous sign-in when they open a join link, then enter a display name.
- AC1: A guest never sees a sign-up form.
- AC2: A guest who refreshes the page stays the same participant (session persists on that device).
- AC3: If a signed-in payer opens their own join link, they are not added twice.

### 7.2 Creating a bill

**FR-BILL-1 (P0) Scan a bill**
Upload or capture an image (JPEG, PNG, WEBP; max 8 MB). The backend sends it to Gemini and returns structured JSON.
- AC1: On a phone, the file picker offers the camera (`accept="image/*"` + `capture="environment"`).
- AC2: A loading state with text ("Reading your bill…") shows while scanning; the button is disabled to prevent double submits.
- AC3: Result arrives in ≤ 15 s for a typical bill, otherwise a timeout error with **Try again** and **Enter manually** options.
- AC4: If the image isn't a bill, the user sees "We couldn't find a bill in that photo" — never a raw error.
- AC5: The image is not stored anywhere after processing.

**FR-BILL-2 (P0) Manual entry**
The same Review screen, starting empty, with **Add item**.
- AC1: A bill can be created with zero scanning.
- AC2: Each item needs a name (1–80 chars), quantity (integer ≥ 1) and total price (≥ ₹0).

**FR-BILL-3 (P0) Review and edit**
One screen used by both scan and manual flows.
- AC1: Every item's name, quantity and price is editable inline; items can be added and deleted.
- AC2: Charges section: tax (GST, combined CGST+SGST), service charge, tip, discount, round-off (can be negative). Each editable.
- AC3: Live totals: items subtotal, charges, grand total — recomputed on every edit.
- AC4: Warnings from the scan are shown at the top (e.g. "Items add up to ₹1,240 but the bill says ₹1,280 — please check").
- AC5: Payer name and UPI ID are required; the UPI ID is validated (`name@bank` format).
- AC6: **Open for splitting** saves the bill (status `open`) and navigates to the Bill room. Before that, the bill is `draft` and not joinable.

**FR-BILL-4 (P1) My bills**
List of the payer's bills with title, date, total, status and "X of Y paid".

### 7.3 Sharing and joining

**FR-SHARE-1 (P0) Share link and QR code**
- AC1: Every open bill has a short share code (8 characters, e.g. `7F3K9QX2`) and link `https://<app>/j/<code>`.
- AC2: The Bill room shows a large QR code of the link (payer view) and a **Copy link** button.

**FR-SHARE-2 (P1) WhatsApp share**
- AC1: A **Share on WhatsApp** button opens `https://wa.me/?text=<encoded message>` containing the restaurant name, total and link.
- AC2: On phones that support it, the native share sheet (`navigator.share`) is used instead.

**FR-JOIN-1 (P0) Join by code**
- AC1: `/j/:code` asks for a name (1–40 chars) and calls the `join_bill` database function.
- AC2: Wrong code → "This bill doesn't exist." Draft or settled bill → "This bill isn't open for splitting."
- AC3: After joining, the guest lands in the Bill room.

### 7.4 Claiming items

**FR-CLAIM-1 (P0) Claim and un-claim**
- AC1: Tapping an item claims it for me (1 share); tapping again removes my claim.
- AC2: Each item shows avatars / initials of everyone who claimed it and "₹X each".
- AC3: Claims are only possible while the bill is `open`.

**FR-CLAIM-2 (P0) Shared items**
- AC1: An item claimed by N people is split between them by shares (default 1 share each).
- AC2: For items with quantity > 1, a participant can take more than one share (stepper), e.g. of 3 beers, A takes 2 shares and B takes 1.

**FR-CLAIM-3 (P0) Live updates**
- AC1: When anyone claims or un-claims, every open screen updates within ~2 s without refresh (Supabase Realtime).
- AC2: If the realtime connection drops, a **Refresh** button still works (fallback).

**FR-CLAIM-4 (P0) Unclaimed warning**
- AC1: The payer sees "N items unclaimed · ₹X" at the top of the Bill room.
- AC2: The payer can **Split leftovers equally** among all participants or assign an item to a specific participant.

**FR-CLAIM-5 (P1) Offline participants**
- AC1: The payer can add a participant by name only (for a friend without a phone) and claim items on their behalf.

### 7.5 Calculating shares

**FR-SPLIT-1 (P0) Fair split** — see Section 8 for exact rules.
- AC1: Every participant's total is shown with a breakdown: items, tax, service charge, tip, discount, round-off.
- AC2: Sum of all participant totals + unclaimed amount = bill grand total, **to the paisa**, always.
- AC3: All money is stored and calculated as integer paise; displayed as `₹1,234.50` using `en-IN` formatting.

### 7.6 Payments

**FR-PAY-1 (P0) UPI payment link**
- AC1: Each guest (not the payer) sees **Pay ₹X to <payer name>**, which opens a `upi://pay` link with payee UPI ID, payee name, exact amount, `INR`, and a note (e.g. "ProSplitter · Café Madras").
- AC2: The button is disabled when the amount is ₹0.
- AC3: The same link is shown as a QR code (so a laptop user can scan it with their phone) plus **Copy UPI ID** as a last-resort fallback.

**FR-PAY-2 (P0) Payment status**
- AC1: A guest can tap **I've paid** → status `marked_paid`.
- AC2: The payer can **Confirm** → status `confirmed`, or reset to `pending`.
- AC3: The payer sees a summary: "3 of 5 paid · ₹1,230 of ₹2,050 received".
- AC4: The UI states honestly that payment is self-reported (no automatic verification).

**FR-PAY-3 (P1) Settle bill**
- AC1: The payer can mark the bill `settled`; claims are then locked.

**FR-PAY-4 (P1) Reminder nudge**
- AC1: For each unpaid guest, the payer can copy a friendly reminder message with the amount and link.

### 7.7 Trip mode (P2 — design and pitch; build only with spare time)

**FR-TRIP-1 (P2)** Group several bills (paid by different people) into a trip.
**FR-TRIP-2 (P2)** Compute each person's net balance across all bills and show the **minimum set of payments** to settle everything (debt simplification, see the split-payments skill).
- AC1: For N people, at most N−1 payments are suggested.
- AC2: Suggested payments sum exactly to the net balances.

---

## 8. Split calculation rules (source of truth)

All amounts are **integer paise**. No floating-point money anywhere.

1. **Item shares.** Each item's `total_price_paise` is divided among its claimants in proportion to their `shares`, using the *largest remainder method* so the pieces add up exactly. Ties go to the claimant who joined earlier.
2. **Unclaimed items.** Items with no claims go to an "unclaimed" bucket, shown to the payer.
3. **Charges.** `net_charges = tax + service_charge + tip − discount + round_off`. This is split in proportion to each person's item subtotal, with the unclaimed bucket included as one more weight (so unclaimed items carry their own share of tax). Largest remainder again.
4. **Totals.** `person_total = item_subtotal + charge_share`. `Σ person_totals + unclaimed_total = grand_total`.
5. **Amount due.** Guests owe their `person_total` to the payer. The payer owes nothing.

### 8.1 Worked example (use as a unit test)

Bill: Paneer Tikka ₹280 · Butter Naan ×4 ₹200 · Veg Biryani ₹320 · Masala Dosa ₹180 · Cold Coffee ×2 ₹300. Subtotal ₹1,280. GST ₹64. Service charge ₹64. Grand total ₹1,408.

Claims: A (payer) → Paneer Tikka, Naan. B → Biryani, Naan. C → Dosa, Naan, Coffee. D → Naan, Coffee.

| Person | Items | Item subtotal | Share of ₹128 charges | Total | Owes |
|---|---|---|---|---|---|
| A (payer) | 280 + 50 | ₹330 | ₹33 | ₹363 | — |
| B | 320 + 50 | ₹370 | ₹37 | ₹407 | ₹407 |
| C | 180 + 50 + 150 | ₹380 | ₹38 | ₹418 | ₹418 |
| D | 50 + 150 | ₹200 | ₹20 | ₹220 | ₹220 |
| **Sum** | | **₹1,280** | **₹128** | **₹1,408** | ₹1,045 |

### 8.2 Rounding example
Naan ₹200.00 (20000 paise) shared by 3 → 6666.67 each → largest remainder gives **6667, 6667, 6666** (first two joiners get the extra paisa). Sum = 20000. ✔

---

## 9. Non-functional requirements

| ID | Area | Requirement |
|---|---|---|
| NFR-1 | Mobile-first | Every screen works one-handed on a 360 px wide phone. Tap targets ≥ 44 px. |
| NFR-2 | Performance | Bill room first render < 2 s on 4G after deploy. Claims reflect on other screens < 2 s. |
| NFR-3 | Reliability | Every network call has a loading state, a user-friendly error message and a retry path. No blank screens, no raw JSON errors, no console errors in the demo. |
| NFR-4 | Security | Row-level security on every table. Guests can only see bills they joined. Only the owner can edit bill items or confirm payments. API keys (Gemini) live only on the backend. |
| NFR-5 | Privacy | Bill images are never stored. Only the extracted text data is saved. Guests provide only a display name. |
| NFR-6 | Correctness | Split totals always add up to the grand total to the paisa (enforced by unit tests on Section 8). |
| NFR-7 | Cost | Everything runs on free tiers with no credit card: Supabase Free, Gemini API free tier, Vercel Hobby, Render Free. |
| NFR-8 | Accessibility | Semantic buttons and labels, visible focus, colour contrast ≥ 4.5:1, amounts announced with the currency. |
| NFR-9 | Trust | Scanned data always passes through the Review screen before anyone can claim; totals mismatches are flagged, not hidden. |

---

## 10. System architecture

```
 ┌──────────────────────────┐        HTTPS (JWT)        ┌──────────────────────────┐
 │  Angular 22 SPA (Vercel) │ ───── POST /api/scan ───▶ │ Express 5 API (Render)   │
 │  - Supabase JS client    │ ◀──── bill JSON ───────── │ - verifies Supabase JWT  │
 │  - Realtime subscription │                            │ - multer (memory only)   │
 └───────────┬──────────────┘                            │ - Gemini (@google/genai) │
             │ supabase-js (anon/publishable key + RLS)  │ - zod validation         │
             ▼                                           └───────────┬──────────────┘
 ┌──────────────────────────────────────────────┐                    │ HTTPS
 │ Supabase                                      │                    ▼
 │ - Auth (email/password + anonymous)           │        ┌──────────────────────┐
 │ - Postgres + RLS + RPC functions              │        │ Gemini API (free)    │
 │ - Realtime (postgres_changes)                 │        └──────────────────────┘
 └──────────────────────────────────────────────┘
```

**Division of responsibility**
- **Express** does exactly one job in the P0 build: scan a bill image with Gemini and return validated JSON. It keeps the Gemini key secret. (Health check endpoint too.)
- **Angular talks to Supabase directly** for all data: creating bills, items, joining, claims and payment status — protected by RLS and a few `security definer` functions. This removes a whole layer of backend code and bugs.
- **Split calculation** is a pure TypeScript function in the frontend, covered by unit tests.

---

## 11. Data model

Full SQL with RLS is in `supabase/schema.sql`. Summary:

| Table | Purpose | Key columns |
|---|---|---|
| `bills` | One row per bill | `id, owner_id, title, restaurant_name, bill_date, payer_name, payer_upi_id, subtotal_paise, tax_paise, service_charge_paise, tip_paise, discount_paise, round_off_paise, total_paise, share_code, status (draft/open/settled), source (scan/manual)` |
| `bill_items` | Line items | `id, bill_id, name, quantity, unit_price_paise, total_price_paise, position` |
| `participants` | People in a bill | `id, bill_id, user_id (null for offline friends), display_name, is_payer, payment_status (pending/marked_paid/confirmed), paid_marked_at, confirmed_at` |
| `item_claims` | Who ate what | `id, bill_id, item_id, participant_id, shares` |

Database functions:
- `join_bill(p_share_code, p_display_name) → json {bill_id, participant_id}`
- `mark_my_payment(p_bill_id)` — guest marks themselves as paid.
- `is_bill_owner(bill_id)`, `is_bill_member(bill_id)` — RLS helpers.

---

## 12. API specification (Express)

Base URL: `https://<render-app>.onrender.com/api`. All responses are JSON. Errors always look like:

```json
{ "error": { "code": "NOT_A_BILL", "message": "We couldn't find a bill in that photo." } }
```

### `GET /api/health`
`200 { "ok": true, "time": "<ISO>" }` — used to wake the free Render instance before the demo.

### `POST /api/scan`
- Auth: `Authorization: Bearer <supabase access token>` (non-anonymous user).
- Body: `multipart/form-data` with field `image` (jpeg/png/webp, ≤ 8 MB).
- `200`:
```json
{
  "restaurantName": "Café Madras",
  "billDate": "2026-09-27",
  "items": [
    { "name": "Masala Dosa", "quantity": 2, "unitPricePaise": 9000, "totalPricePaise": 18000 }
  ],
  "subtotalPaise": 128000,
  "taxPaise": 6400,
  "serviceChargePaise": 6400,
  "tipPaise": 0,
  "discountPaise": 0,
  "roundOffPaise": 0,
  "totalPaise": 140800,
  "warnings": ["Items add up to ₹1,240.00 but the bill subtotal says ₹1,280.00."]
}
```
- Errors: `400 NO_IMAGE`, `400 UNSUPPORTED_TYPE`, `413 FILE_TOO_LARGE`, `401 UNAUTHENTICATED`, `403 GUEST_NOT_ALLOWED`, `422 NOT_A_BILL`, `429 RATE_LIMITED`, `502 SCAN_FAILED`, `504 SCAN_TIMEOUT`.

---

## 13. Screens

| Route | Screen | Who | P |
|---|---|---|---|
| `/` | Landing + sign in / sign up | Everyone | P0 |
| `/bills` | My bills | Payer | P1 |
| `/bills/new` | New bill: Scan or Enter manually | Payer | P0 |
| `/bills/:id/review` | Review & edit items, charges, payer UPI | Payer | P0 |
| `/bill/:id` | Bill room (payer and guest views of the same screen) | Both | P0 |
| `/j/:code` | Join: enter your name | Guest | P0 |
| `**` | Not found | Everyone | P0 |

**Bill room layout (mobile):**
1. Header: restaurant, total, status chip.
2. (Payer) Share card: QR code, copy link, WhatsApp. Unclaimed warning bar.
3. Item list: name, qty, price, claimant chips, "₹X each", tap to claim.
4. Sticky bottom bar: "Your share ₹407.00 · Pay" (guest) or "4/5 paid" (payer).
5. People tab/section: each participant, total, payment status, confirm buttons (payer).

---

## 14. Error and empty states (must all be designed)

| Situation | What the user sees |
|---|---|
| Scan timeout / Gemini error | "Couldn't read the bill right now." [Try again] [Enter manually] |
| Not a bill | "We couldn't find a bill in that photo." [Retake] [Enter manually] |
| Totals mismatch | Yellow banner with both numbers; user can still continue |
| Invalid UPI ID | Inline: "Enter a UPI ID like name@okhdfcbank" |
| Wrong join code | "This bill doesn't exist. Check the link with your friend." |
| Bill not open | "This bill isn't open for splitting yet." |
| No items claimed by me | "Tap the dishes you had." |
| Realtime disconnected | Small "Offline — tap to refresh" chip |
| Backend asleep (Render cold start) | Scan shows "Waking up the server…" after 5 s |

---

## 15. Tech stack and versions

| Layer | Choice |
|---|---|
| Frontend | Angular 22 (standalone components, signals, zoneless, `@if/@for` control flow), TypeScript strict, SCSS, `@supabase/supabase-js` v2, `qrcode` |
| Backend | Node 24, Express 5 (ESM), `multer`, `zod`, `@google/genai`, `@supabase/supabase-js`, `helmet`, `cors`, `express-rate-limit`, `dotenv` |
| Database/Auth | Supabase Free: Postgres, RLS, Auth (email + anonymous), Realtime |
| AI | Gemini API free tier (a current Flash model; model name in an env var) |
| Hosting | Vercel Hobby (frontend), Render Free web service (backend) |

---

## 16. Environment variables

**Backend (`backend/.env`)**
| Name | Example | Notes |
|---|---|---|
| `PORT` | `8080` | Render sets this automatically |
| `CORS_ORIGINS` | `http://localhost:4200,https://prosplitter.vercel.app` | Comma-separated |
| `SUPABASE_URL` | `https://xyz.supabase.co` | |
| `SUPABASE_ANON_KEY` | `sb_publishable_...` or legacy anon key | Used only to verify user JWTs |
| `GEMINI_API_KEY` | `AIza...` | From Google AI Studio. Never in the frontend |
| `GEMINI_MODEL` | a current free Flash model | Check AI Studio for the free models on your key |
| `SCAN_TIMEOUT_MS` | `25000` | |

**Frontend (`src/environments/environment*.ts`)**
`supabaseUrl`, `supabaseAnonKey` (publishable key — safe in the browser because RLS protects data), `apiBaseUrl`, `appBaseUrl`.

---

## 17. Build plan (≈2 h 20 min)

| Time | Milestone | Done when |
|---|---|---|
| 0:00–0:20 | Setup | Supabase project + `schema.sql` run + anonymous sign-ins enabled + email confirm off; Angular and Express skeletons running locally; first deploy of both "hello" apps |
| 0:20–0:55 | Scan + Review | `/api/scan` returns validated JSON; Review screen edits items and charges; manual entry works; bill saves as `open` |
| 0:55–1:30 | Share + Join + Claim | QR/link, join by name, claim/un-claim, shared items, realtime updates |
| 1:30–1:55 | Split + Pay | Split function with unit tests passing; per-person breakdown; UPI links + QR; I've paid / Confirm; unclaimed bar |
| 1:55–2:20 | Harden + deploy | All error states; test full flow on 2 phones on the deployed URL; seed demo bill; freeze code |

**Cut order if late:** FR-SHARE-2 → FR-CLAIM-5 → FR-BILL-4 → realtime (use Refresh button). Never cut: Review screen, error states, split tests.

### 17.1 Team split (4 people; merge roles for smaller teams)

| Person | Owns | Skills to use |
|---|---|---|
| 1. Platform | Supabase setup, `schema.sql`, auth service, deployment, env vars, demo data | `prosplitter-supabase`, `prosplitter-deploy` |
| 2. Backend | Express app, `/api/scan`, Gemini prompt, validation, reconciliation | `prosplitter-express`, `prosplitter-bill-scan` |
| 3. Frontend A | Landing/auth, New bill, Review screen, API service | `prosplitter-angular` |
| 4. Frontend B | Join, Bill room, realtime, split function + tests, UPI/QR | `prosplitter-angular`, `prosplitter-split-payments` |

Interfaces agreed in the first 10 minutes: the `/api/scan` response shape (Section 12) and the table/column names (Section 11). Frontend A can mock `/api/scan` with a JSON fixture until the backend is ready.

---

## 18. Test plan and demo checklist

**Automated (must pass before demo)**
- Split function: Section 8.1 example, 8.2 rounding, all-unclaimed bill, discount larger than tax, negative round-off, zero-item bill, single participant.
- UPI link builder: encoding of spaces and `&` in names/notes, amount formatting (`407.00`), invalid VPA rejected.
- Backend: `/api/scan` rejects missing file, wrong type, oversized file, missing token, anonymous token.

**Manual (on the deployed URL, two real phones)**
- [ ] Sign up, scan a real bill, fix one item, open bill.
- [ ] Guest joins via QR, claims items; host sees it live.
- [ ] Shared item splits correctly; totals add up to grand total.
- [ ] UPI button opens a UPI app with correct amount and name on Android.
- [ ] I've paid → Confirm flow works.
- [ ] Every error state in Section 14 reachable and readable.
- [ ] No console errors.

**Demo script (5 min)**
1. (30 s) Problem + user + moment.
2. (2 min) Photograph a real bill live → review → open → QR on screen → two judges join and claim → totals update live → one judge taps Pay and sees the exact amount in their UPI app.
3. (1 min) Show fair tax split breakdown vs. equal split difference.
4. (1 min) Design: architecture, RLS, paise maths, privacy (images never stored).
5. (30 s) Vision: Trip mode with minimum-payment settlement.

---

## 19. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Gemini misreads a bill | Mandatory Review screen; totals reconciliation warnings; manual entry always available |
| Gemini free-tier limits or model name changes | Model in env var; test key before the event; manual entry fallback keeps the demo alive |
| Some UPI apps refuse payment links to personal UPI IDs or cap the amount | Test with the team's apps beforehand; always show QR + Copy UPI ID fallback; say so honestly in the pitch |
| Render free instance sleeps | Hit `/api/health` 2 minutes before the demo; "Waking up the server…" message |
| Supabase auth emails rate-limited | Email confirmation disabled; guests use anonymous sign-in |
| Realtime issues on venue Wi-Fi | Refresh button fallback; demo on mobile data hotspot |
| Floating-point rounding bugs | Integer paise everywhere + unit tests |

---

## 20. How this maps to the judging criteria

| Stage | Where it's covered |
|---|---|
| 1. Define the problem (10) | Section 2: specific user, moment, statement |
| 2. Ideal state (20) | Section 3 |
| 3. Solution design (50) | Sections 7–12: data (bill image → structured items), engineering (vision extraction + reconciliation, fair-split algorithm, realtime, RLS), product (zero sign-up guests, trust via review screen, honest payment status) |
| 4. Build and present (50) | Sections 17–18: tight P0 scope, error states, tests, rehearsed demo |
| Team contribution (50) | Everyone uses their AI tool with this kit; save and share transcripts |
| Novelty bonus (50) | Photo → live multiplayer claiming → proportional tax split → UPI; Trip mode settlement |

---

## 21. Future roadmap
- Trip mode with minimum-payment settlement (P2 above).
- Payment gateway (e.g. UPI collect/intent via a PSP) for verified payments.
- Recurring groups (flatmates, office lunch crew) with running balances.
- Split delivery orders by forwarding the order confirmation email.
- Regional languages for the guest view.
