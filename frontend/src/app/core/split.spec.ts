import { describe, expect, it } from 'vitest';
import type { BillItem, ItemClaim, Participant } from './models';
import { computeSplit, largestRemainder, netCharges, type SplitBill } from './split';

const bill = (over: Partial<SplitBill> = {}): SplitBill => ({
  tax_paise: 0,
  service_charge_paise: 0,
  tip_paise: 0,
  discount_paise: 0,
  round_off_paise: 0,
  ...over,
});

let seq = 0;
const item = (id: string, name: string, totalRupees: number, quantity = 1): BillItem => ({
  id,
  name,
  quantity,
  unit_price_paise: Math.round((totalRupees * 100) / quantity),
  total_price_paise: Math.round(totalRupees * 100),
  position: seq++,
});

const person = (id: string, name: string, isPayer = false): Participant => ({
  id,
  display_name: name,
  is_payer: isPayer ? 1 : 0,
  payment_status: 'pending',
  amount_due_paise: 0,
  created_at: `2026-09-27T10:0${seq++}:00Z`,
});

const claim = (itemId: string, participantId: string, shares = 1): ItemClaim => ({
  item_id: itemId,
  participant_id: participantId,
  shares,
});

/** The invariant from NFR-6, asserted on every scenario below. */
function expectAddsUp(result: ReturnType<typeof computeSplit>) {
  const sum =
    result.people.reduce((acc, p) => acc + p.totalPaise, 0) + result.unclaimed.totalPaise;
  expect(sum).toBe(result.grandTotalPaise);
}

describe('largestRemainder', () => {
  it('splits ₹200.00 three ways with the extra paise going to earlier joiners (PRD 8.2)', () => {
    expect(largestRemainder(20000, [1, 1, 1])).toEqual([6667, 6667, 6666]);
  });

  it('always sums to the amount, for any weights', () => {
    for (const amount of [1, 7, 100, 12345, 99999, 1_000_001]) {
      for (const weights of [[1, 1, 1], [3, 1], [5, 5, 5, 5, 5, 5, 5], [1, 2, 3, 4]]) {
        const parts = largestRemainder(amount, weights);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(amount);
      }
    }
  });

  it('handles a negative amount (discount larger than tax)', () => {
    const parts = largestRemainder(-1000, [1, 1, 3]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-1000);
  });

  it('splits evenly when every weight is zero', () => {
    expect(largestRemainder(10, [0, 0, 0, 0])).toEqual([3, 3, 2, 2]);
  });

  it('returns nothing for no weights', () => {
    expect(largestRemainder(500, [])).toEqual([]);
  });
});

describe('computeSplit — worked example from PRD 8.1', () => {
  const items = [
    item('paneer', 'Paneer Tikka', 280),
    item('naan', 'Butter Naan', 200, 4),
    item('biryani', 'Veg Biryani', 320),
    item('dosa', 'Masala Dosa', 180),
    item('coffee', 'Cold Coffee', 300, 2),
  ];
  const [a, b, c, d] = [person('A', 'Aarav', true), person('B', 'Bhavna'), person('C', 'Chirag'), person('D', 'Dia')];
  const claims = [
    claim('paneer', 'A'), claim('naan', 'A'),
    claim('biryani', 'B'), claim('naan', 'B'),
    claim('dosa', 'C'), claim('naan', 'C'), claim('coffee', 'C'),
    claim('naan', 'D'), claim('coffee', 'D'),
  ];
  const theBill = bill({ tax_paise: 6400, service_charge_paise: 6400 });
  const result = computeSplit(theBill, items, [a, b, c, d], claims);

  it('charges ₹128.00 in total', () => {
    expect(netCharges(theBill)).toBe(12800);
  });

  it('gives each person the totals in the PRD table', () => {
    const totals = Object.fromEntries(result.people.map((p) => [p.displayName, p.totalPaise]));
    expect(totals).toEqual({ Aarav: 36300, Bhavna: 40700, Chirag: 41800, Dia: 22000 });
  });

  it('gives each person the item subtotals in the PRD table', () => {
    const subs = Object.fromEntries(result.people.map((p) => [p.displayName, p.itemSubtotalPaise]));
    expect(subs).toEqual({ Aarav: 33000, Bhavna: 37000, Chirag: 38000, Dia: 20000 });
  });

  it('adds up to the ₹1,408.00 grand total', () => {
    expect(result.grandTotalPaise).toBe(140800);
    expect(result.unclaimed.totalPaise).toBe(0);
    expectAddsUp(result);
  });
});

describe('computeSplit — edge cases', () => {
  it('puts everything in the unclaimed bucket when nobody claims', () => {
    const items = [item('x', 'Thali', 500)];
    const result = computeSplit(bill({ tax_paise: 2500 }), items, [person('A', 'Aarav')], []);
    expect(result.people[0]!.totalPaise).toBe(0);
    expect(result.unclaimed.itemCount).toBe(1);
    expect(result.unclaimed.totalPaise).toBe(52500);
    expectAddsUp(result);
  });

  it('makes unclaimed items carry their own share of tax', () => {
    const items = [item('x', 'Thali', 500), item('y', 'Lassi', 500)];
    const result = computeSplit(
      bill({ tax_paise: 10000 }),
      items,
      [person('A', 'Aarav')],
      [claim('x', 'A')],
    );
    expect(result.people[0]!.chargeSharePaise).toBe(5000);
    expect(result.unclaimed.chargeSharePaise).toBe(5000);
    expectAddsUp(result);
  });

  it('handles a discount larger than the tax', () => {
    const items = [item('x', 'Pizza', 400), item('y', 'Pasta', 600)];
    const result = computeSplit(
      bill({ tax_paise: 2000, discount_paise: 30000 }),
      items,
      [person('A', 'Aarav'), person('B', 'Bhavna')],
      [claim('x', 'A'), claim('y', 'B')],
    );
    expect(result.netChargesPaise).toBe(-28000);
    expect(result.grandTotalPaise).toBe(72000);
    expectAddsUp(result);
  });

  it('handles a negative round off', () => {
    const items = [item('x', 'Dosa', 123.45)];
    const result = computeSplit(
      bill({ round_off_paise: -45 }),
      items,
      [person('A', 'Aarav')],
      [claim('x', 'A')],
    );
    expect(result.people[0]!.totalPaise).toBe(12300);
    expectAddsUp(result);
  });

  it('handles a bill with no items at all', () => {
    const result = computeSplit(bill({ tax_paise: 500 }), [], [person('A', 'Aarav')], []);
    expect(result.people[0]!.totalPaise).toBe(500);
    expect(result.unclaimed.itemCount).toBe(0);
    expectAddsUp(result);
  });

  it('gives a single participant the entire bill', () => {
    const items = [item('x', 'Biryani', 320), item('y', 'Coke', 60)];
    const result = computeSplit(
      bill({ tax_paise: 1900, service_charge_paise: 1900 }),
      items,
      [person('A', 'Aarav', true)],
      [claim('x', 'A'), claim('y', 'A')],
    );
    expect(result.people[0]!.totalPaise).toBe(41800);
    expectAddsUp(result);
  });

  it('splits by shares on a multi-quantity item (2 of 3 beers)', () => {
    const items = [item('beer', 'Beer', 900, 3)];
    const result = computeSplit(
      bill(),
      items,
      [person('A', 'Aarav'), person('B', 'Bhavna')],
      [claim('beer', 'A', 2), claim('beer', 'B', 1)],
    );
    expect(result.people[0]!.itemSubtotalPaise).toBe(60000);
    expect(result.people[1]!.itemSubtotalPaise).toBe(30000);
    expectAddsUp(result);
  });

  it('ignores claims whose participant has been removed', () => {
    const items = [item('x', 'Dosa', 100)];
    const result = computeSplit(bill(), items, [person('A', 'Aarav')], [claim('x', 'GHOST')]);
    expect(result.unclaimed.itemCount).toBe(1);
    expectAddsUp(result);
  });

  it('never loses a paisa on an awkward three-way split with charges', () => {
    const items = [item('x', 'Shared platter', 100.01)];
    const result = computeSplit(
      bill({ tax_paise: 501, service_charge_paise: 499 }),
      items,
      [person('A', 'Aarav'), person('B', 'Bhavna'), person('C', 'Chirag')],
      [claim('x', 'A'), claim('x', 'B'), claim('x', 'C')],
    );
    expect(result.grandTotalPaise).toBe(11001);
    expectAddsUp(result);
  });
});
