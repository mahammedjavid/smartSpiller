import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.databaseFile), { recursive: true });

export const db = new DatabaseSync(config.databaseFile);

db.exec(`
  pragma journal_mode = WAL;
  pragma foreign_keys = ON;

  create table if not exists bills (
    code                 text primary key,
    owner_token          text not null,
    title                text not null default 'Bill',
    restaurant_name      text,
    bill_date            text,
    payer_name           text not null default '',
    payer_upi_id         text not null default '',
    subtotal_paise       integer not null default 0,
    tax_paise            integer not null default 0,
    service_charge_paise integer not null default 0,
    tip_paise            integer not null default 0,
    discount_paise       integer not null default 0,
    round_off_paise      integer not null default 0,
    total_paise          integer not null default 0,
    status               text not null default 'draft',
    source               text not null default 'manual',
    created_at           text not null default (datetime('now'))
  );

  create table if not exists items (
    id                text primary key,
    bill_code         text not null references bills(code) on delete cascade,
    name              text not null,
    quantity          integer not null default 1,
    unit_price_paise  integer not null default 0,
    total_price_paise integer not null default 0,
    position          integer not null default 0
  );
  create index if not exists items_bill on items(bill_code, position);

  create table if not exists participants (
    id               text primary key,
    bill_code        text not null references bills(code) on delete cascade,
    display_name     text not null,
    is_payer         integer not null default 0,
    payment_status   text not null default 'pending',
    amount_due_paise integer not null default 0,
    created_at       text not null default (datetime('now'))
  );
  create index if not exists participants_bill on participants(bill_code, created_at);

  create table if not exists claims (
    bill_code      text not null references bills(code) on delete cascade,
    item_id        text not null references items(id) on delete cascade,
    participant_id text not null references participants(id) on delete cascade,
    shares         integer not null default 1,
    primary key (item_id, participant_id)
  );
  create index if not exists claims_bill on claims(bill_code);
`);

/** 8 characters, no ambiguous glyphs — this is what people read off a screen. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newShareCode(): string {
  const exists = db.prepare('select 1 from bills where code = ?');
  for (;;) {
    let code = '';
    for (let i = 0; i < 8; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!exists.get(code)) return code;
  }
}

export const newId = (): string => randomUUID();

export interface BillRow {
  code: string;
  owner_token: string;
  title: string;
  restaurant_name: string | null;
  bill_date: string | null;
  payer_name: string;
  payer_upi_id: string;
  subtotal_paise: number;
  tax_paise: number;
  service_charge_paise: number;
  tip_paise: number;
  discount_paise: number;
  round_off_paise: number;
  total_paise: number;
  status: 'draft' | 'open' | 'settled';
  source: 'scan' | 'manual';
  created_at: string;
}

export interface ItemRow {
  id: string;
  bill_code: string;
  name: string;
  quantity: number;
  unit_price_paise: number;
  total_price_paise: number;
  position: number;
}

export interface ParticipantRow {
  id: string;
  bill_code: string;
  display_name: string;
  is_payer: number;
  payment_status: 'pending' | 'marked_paid' | 'confirmed';
  amount_due_paise: number;
  created_at: string;
}

export interface ClaimRow {
  bill_code: string;
  item_id: string;
  participant_id: string;
  shares: number;
}

/** node:sqlite returns loose records; these narrow them at the single read site. */
const asRow = <T>(value: unknown): T | undefined => (value as T | undefined) ?? undefined;
const asRows = <T>(value: unknown): T[] => value as T[];

export const getBill = (code: string): BillRow | undefined =>
  asRow<BillRow>(db.prepare('select * from bills where code = ?').get(code));

/**
 * The whole room in one object. Every read endpoint and every SSE push sends
 * this exact shape, so the client only ever has one way to apply state.
 */
export function billState(code: string) {
  const bill = getBill(code);
  if (!bill) return null;

  const { owner_token, ...publicBill } = bill;
  return {
    bill: publicBill,
    items: asRows<ItemRow>(
      db.prepare('select * from items where bill_code = ? order by position').all(code),
    ),
    participants: asRows<ParticipantRow>(
      db.prepare('select * from participants where bill_code = ? order by created_at, rowid').all(code),
    ),
    claims: asRows<ClaimRow>(db.prepare('select * from claims where bill_code = ?').all(code)),
  };
}

export type BillState = NonNullable<ReturnType<typeof billState>>;

/** Keeps the stored subtotal and total consistent with the items on every write. */
export function recalculateTotals(code: string): void {
  const bill = getBill(code);
  if (!bill) return;

  const row = db
    .prepare('select coalesce(sum(total_price_paise), 0) as subtotal from items where bill_code = ?')
    .get(code) as unknown as { subtotal: number };

  const total =
    row.subtotal +
    bill.tax_paise +
    bill.service_charge_paise +
    bill.tip_paise -
    bill.discount_paise +
    bill.round_off_paise;

  db.prepare('update bills set subtotal_paise = ?, total_paise = ? where code = ?').run(
    row.subtotal,
    total,
    code,
  );
}
