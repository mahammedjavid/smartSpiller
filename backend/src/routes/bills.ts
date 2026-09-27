import { Router, type Request } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import {
  billState,
  db,
  getBill,
  newId,
  newShareCode,
  recalculateTotals,
  type BillRow,
} from '../db.js';
import { broadcast, subscribe } from '../events.js';

export const billsRouter: Router = Router();

const itemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  quantity: z.number().int().min(1).max(999),
  unitPricePaise: z.number().int().min(0),
  totalPricePaise: z.number().int().min(0),
});

const chargesSchema = z.object({
  taxPaise: z.number().int(),
  serviceChargePaise: z.number().int(),
  tipPaise: z.number().int(),
  discountPaise: z.number().int(),
  roundOffPaise: z.number().int(),
});

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError('BAD_REQUEST', result.error.message);
  return result.data;
}

/** The bill must exist; used by every route below. */
function requireBill(code: string): BillRow {
  const bill = getBill(code.toUpperCase());
  if (!bill) throw new ApiError('BILL_NOT_FOUND');
  return bill;
}

/**
 * The owner token is held in the creator's localStorage and sent as a header.
 * It is the only thing separating the payer's controls from a guest's.
 */
function requireOwner(req: Request, code: string): BillRow {
  const bill = requireBill(code);
  const token = req.header('x-owner-token');
  if (!token || token !== bill.owner_token) throw new ApiError('NOT_BILL_OWNER');
  return bill;
}

function requireOpen(bill: BillRow): void {
  if (bill.status !== 'open') throw new ApiError('BILL_NOT_OPEN');
}

function replaceItems(code: string, items: z.infer<typeof itemSchema>[]): void {
  db.prepare('delete from items where bill_code = ?').run(code);
  const insert = db.prepare(
    'insert into items (id, bill_code, name, quantity, unit_price_paise, total_price_paise, position) values (?,?,?,?,?,?,?)',
  );
  items.forEach((item, position) => {
    insert.run(newId(), code, item.name, item.quantity, item.unitPricePaise, item.totalPricePaise, position);
  });
}

// ── create ───────────────────────────────────────────────────
billsRouter.post('/bills', (req, res) => {
  const body = parse(
    z.object({
      source: z.enum(['scan', 'manual']).default('manual'),
      restaurantName: z.string().nullable().optional(),
      billDate: z.string().nullable().optional(),
      items: z.array(itemSchema).default([]),
      charges: chargesSchema.partial().optional(),
    }),
    req.body,
  );

  const code = newShareCode();
  const ownerToken = newId();
  const charges = body.charges ?? {};

  db.prepare(
    `insert into bills (code, owner_token, title, restaurant_name, bill_date, source,
                        tax_paise, service_charge_paise, tip_paise, discount_paise, round_off_paise)
     values (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    code,
    ownerToken,
    body.restaurantName ?? 'Bill',
    body.restaurantName ?? null,
    body.billDate ?? null,
    body.source,
    charges.taxPaise ?? 0,
    charges.serviceChargePaise ?? 0,
    charges.tipPaise ?? 0,
    charges.discountPaise ?? 0,
    charges.roundOffPaise ?? 0,
  );

  replaceItems(code, body.items);
  recalculateTotals(code);

  res.status(201).json({ code, ownerToken, ...billState(code)! });
});

// ── read ─────────────────────────────────────────────────────
billsRouter.get('/bills/:code', (req, res) => {
  const bill = requireBill(req.params.code!);
  res.json(billState(bill.code));
});

/** Live updates. The stream sends the full room state on connect and on change. */
billsRouter.get('/bills/:code/stream', (req, res) => {
  const bill = requireBill(req.params.code!);
  const unsubscribe = subscribe(bill.code, res);
  req.on('close', unsubscribe);
});

// ── edit (owner) ─────────────────────────────────────────────
billsRouter.put('/bills/:code', (req, res) => {
  const bill = requireOwner(req, req.params.code!);
  if (bill.status === 'settled') throw new ApiError('BILL_NOT_OPEN');

  const body = parse(
    z.object({
      title: z.string().trim().max(120).optional(),
      restaurantName: z.string().trim().nullable().optional(),
      billDate: z.string().nullable().optional(),
      payerName: z.string().trim().max(40),
      payerUpiId: z.string().trim().max(120),
      charges: chargesSchema,
      items: z.array(itemSchema),
    }),
    req.body,
  );

  db.prepare(
    `update bills set title = ?, restaurant_name = ?, bill_date = ?, payer_name = ?, payer_upi_id = ?,
                      tax_paise = ?, service_charge_paise = ?, tip_paise = ?, discount_paise = ?, round_off_paise = ?
     where code = ?`,
  ).run(
    body.title || body.restaurantName || 'Bill',
    body.restaurantName ?? null,
    body.billDate ?? null,
    body.payerName,
    body.payerUpiId,
    body.charges.taxPaise,
    body.charges.serviceChargePaise,
    body.charges.tipPaise,
    body.charges.discountPaise,
    body.charges.roundOffPaise,
    bill.code,
  );

  replaceItems(bill.code, body.items);
  recalculateTotals(bill.code);
  broadcast(bill.code);
  res.json(billState(bill.code));
});

/** Publishes the bill and makes the payer the first participant. */
billsRouter.post('/bills/:code/open', (req, res) => {
  const bill = requireOwner(req, req.params.code!);

  if (bill.status === 'draft') {
    db.prepare("update bills set status = 'open' where code = ?").run(bill.code);
  }

  let payer = db
    .prepare('select * from participants where bill_code = ? and is_payer = 1')
    .get(bill.code) as unknown as { id: string } | undefined;

  if (!payer) {
    const id = newId();
    db.prepare(
      'insert into participants (id, bill_code, display_name, is_payer) values (?,?,?,1)',
    ).run(id, bill.code, bill.payer_name || 'Me');
    payer = { id };
  }

  broadcast(bill.code);
  res.json({ participantId: payer.id, ...billState(bill.code)! });
});

billsRouter.post('/bills/:code/settle', (req, res) => {
  const bill = requireOwner(req, req.params.code!);
  db.prepare("update bills set status = 'settled' where code = ?").run(bill.code);
  broadcast(bill.code);
  res.json(billState(bill.code));
});

// ── join ─────────────────────────────────────────────────────
billsRouter.post('/bills/:code/join', (req, res) => {
  const bill = requireBill(req.params.code!);
  requireOpen(bill);

  const { name, participantId } = parse(
    z.object({
      name: z.string().trim().min(1).max(40),
      // A returning device sends the id it already has, so it isn't duplicated.
      participantId: z.string().optional(),
    }),
    req.body,
  );

  // The id this device already holds, if any.
  let existing = participantId
    ? (db
        .prepare('select id from participants where id = ? and bill_code = ?')
        .get(participantId, bill.code) as unknown as { id: string } | undefined)
    : undefined;

  // Otherwise match on the name. Without this, joining again from a second
  // device or a cleared browser creates "Vaishali" alongside "vaishali".
  existing ??= db
    .prepare('select id from participants where bill_code = ? and lower(trim(display_name)) = ?')
    .get(bill.code, name.toLowerCase()) as unknown as { id: string } | undefined;

  let id: string;
  if (existing) {
    id = existing.id;
    db.prepare('update participants set display_name = ? where id = ?').run(name, id);
  } else {
    id = newId();
    db.prepare('insert into participants (id, bill_code, display_name) values (?,?,?)').run(
      id,
      bill.code,
      name,
    );
  }

  broadcast(bill.code);
  res.json({ participantId: id, ...billState(bill.code)! });
});

/** The payer adds someone who isn't holding a phone. */
billsRouter.post('/bills/:code/participants', (req, res) => {
  const bill = requireOwner(req, req.params.code!);
  const { name } = parse(z.object({ name: z.string().trim().min(1).max(40) }), req.body);

  const already = db
    .prepare('select id from participants where bill_code = ? and lower(trim(display_name)) = ?')
    .get(bill.code, name.toLowerCase());

  if (!already) {
    db.prepare('insert into participants (id, bill_code, display_name) values (?,?,?)').run(
      newId(),
      bill.code,
      name,
    );
  }
  broadcast(bill.code);
  res.json(billState(bill.code));
});

// ── claims ───────────────────────────────────────────────────
billsRouter.put('/bills/:code/claims', (req, res) => {
  const bill = requireBill(req.params.code!);
  requireOpen(bill);

  const { itemId, participantId, shares } = parse(
    z.object({
      itemId: z.string(),
      participantId: z.string(),
      shares: z.number().int().min(1).max(999).default(1),
    }),
    req.body,
  );

  const item = db
    .prepare('select id, quantity from items where id = ? and bill_code = ?')
    .get(itemId, bill.code) as unknown as { quantity: number } | undefined;
  if (!item) throw new ApiError('BAD_REQUEST', 'No such item on this bill.');

  const known = db
    .prepare('select 1 from participants where id = ? and bill_code = ?')
    .get(participantId, bill.code);
  if (!known) throw new ApiError('NOT_A_PARTICIPANT');

  db.prepare(
    `insert into claims (bill_code, item_id, participant_id, shares) values (?,?,?,?)
     on conflict(item_id, participant_id) do update set shares = excluded.shares`,
  ).run(bill.code, itemId, participantId, Math.min(shares, Math.max(1, item.quantity)));

  broadcast(bill.code);
  res.json(billState(bill.code));
});

billsRouter.delete('/bills/:code/claims', (req, res) => {
  const bill = requireBill(req.params.code!);
  requireOpen(bill);

  const { itemId, participantId } = parse(
    z.object({ itemId: z.string(), participantId: z.string() }),
    req.body,
  );

  db.prepare('delete from claims where item_id = ? and participant_id = ?').run(itemId, participantId);
  broadcast(bill.code);
  res.json(billState(bill.code));
});

/** Hands every unclaimed item to everyone, one share each. */
billsRouter.post('/bills/:code/leftovers', (req, res) => {
  const bill = requireOwner(req, req.params.code!);
  requireOpen(bill);

  const unclaimed = db
    .prepare(
      'select id from items where bill_code = ? and id not in (select item_id from claims where bill_code = ?)',
    )
    .all(bill.code, bill.code) as unknown as Array<{ id: string }>;
  const people = db
    .prepare('select id from participants where bill_code = ?')
    .all(bill.code) as unknown as Array<{ id: string }>;

  const insert = db.prepare(
    `insert into claims (bill_code, item_id, participant_id, shares) values (?,?,?,1)
     on conflict(item_id, participant_id) do nothing`,
  );
  for (const item of unclaimed) for (const person of people) insert.run(bill.code, item.id, person.id);

  broadcast(bill.code);
  res.json(billState(bill.code));
});

// ── payments ─────────────────────────────────────────────────
billsRouter.post('/bills/:code/payment', (req, res) => {
  const bill = requireBill(req.params.code!);

  const { participantId, status, amountPaise } = parse(
    z.object({
      participantId: z.string(),
      status: z.enum(['pending', 'marked_paid', 'confirmed']),
      amountPaise: z.number().int().min(0).optional(),
    }),
    req.body,
  );

  // Anyone in the room can say "I've paid"; only the payer can confirm receipt.
  if (status === 'confirmed') requireOwner(req, bill.code);

  const known = db
    .prepare('select 1 from participants where id = ? and bill_code = ?')
    .get(participantId, bill.code);
  if (!known) throw new ApiError('NOT_A_PARTICIPANT');

  db.prepare(
    'update participants set payment_status = ?, amount_due_paise = coalesce(?, amount_due_paise) where id = ?',
  ).run(status, amountPaise ?? null, participantId);

  broadcast(bill.code);
  res.json(billState(bill.code));
});
