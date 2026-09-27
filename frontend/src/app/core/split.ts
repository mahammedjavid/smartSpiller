import type { Bill, BillItem, ItemClaim, Participant } from './models';

/**
 * Splits `amount` across `weights` using the largest remainder method, entirely
 * in integers, so the returned pieces sum to `amount` exactly — no float drift.
 *
 * Ties go to the earlier index, which callers order by join time (PRD 8.1).
 * Works for a negative `amount` too (a discount bigger than the taxes).
 */
export function largestRemainder(amount: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];

  let total = 0;
  for (const w of weights) total += w;

  // Nothing to weigh by (e.g. a ₹0 subtotal with a service charge) → split evenly.
  const effective = total === 0 ? weights.map(() => 1) : weights.slice();
  if (total === 0) total = n;

  const base = new Array<number>(n);
  const remainder = new Array<number>(n);
  let distributed = 0;

  for (let i = 0; i < n; i++) {
    const numerator = amount * effective[i]!;
    const share = Math.floor(numerator / total);
    base[i] = share;
    remainder[i] = numerator - share * total; // integer in [0, total)
    distributed += share;
  }

  let leftover = amount - distributed; // integer in [0, n)
  const order = base
    .map((_, i) => i)
    .sort((a, b) => remainder[b]! - remainder[a]! || a - b);

  for (let k = 0; k < leftover; k++) base[order[k]!]! += 1;

  return base;
}

export interface PersonItemShare {
  itemId: string;
  name: string;
  myShares: number;
  totalShares: number;
  amountPaise: number;
}

export interface PersonSplit {
  participantId: string;
  displayName: string;
  isPayer: boolean;
  items: PersonItemShare[];
  itemSubtotalPaise: number;
  chargeSharePaise: number;
  /** What this person's food plus their proportional share of charges comes to. */
  totalPaise: number;
}

export interface UnclaimedSplit {
  itemIds: string[];
  itemCount: number;
  itemSubtotalPaise: number;
  chargeSharePaise: number;
  totalPaise: number;
}

export interface SplitResult {
  people: PersonSplit[];
  unclaimed: UnclaimedSplit;
  /** tax + service charge + tip − discount + round off */
  netChargesPaise: number;
  grandTotalPaise: number;
  /** Per item, so the bill room can show "₹X each". */
  perItem: Map<string, { totalShares: number; claimantCount: number; eachPaise: number }>;
}

export type SplitBill = Pick<
  Bill,
  | 'tax_paise'
  | 'service_charge_paise'
  | 'tip_paise'
  | 'discount_paise'
  | 'round_off_paise'
>;

export const netCharges = (bill: SplitBill): number =>
  bill.tax_paise + bill.service_charge_paise + bill.tip_paise - bill.discount_paise + bill.round_off_paise;

/**
 * The source of truth for who owes what (PRD section 8).
 *
 * Guarantee: `Σ people.totalPaise + unclaimed.totalPaise === grandTotalPaise`,
 * to the paisa, for any input — that invariant is what the unit tests pin down.
 */
export function computeSplit(
  bill: SplitBill,
  items: readonly BillItem[],
  participants: readonly Participant[],
  claims: readonly ItemClaim[],
): SplitResult {
  // Join order decides rounding ties, so sort once and index everything off it.
  const people = [...participants];
  const indexOf = new Map(people.map((p, i) => [p.id, i]));

  const itemSubtotals = new Array<number>(people.length).fill(0);
  const perPersonItems: PersonItemShare[][] = people.map(() => []);
  const perItem: SplitResult['perItem'] = new Map();

  const unclaimedIds: string[] = [];
  let unclaimedSubtotal = 0;

  const claimsByItem = new Map<string, ItemClaim[]>();
  for (const claim of claims) {
    if (!indexOf.has(claim.participant_id)) continue; // participant was removed
    const list = claimsByItem.get(claim.item_id);
    if (list) list.push(claim);
    else claimsByItem.set(claim.item_id, [claim]);
  }

  for (const item of items) {
    const itemClaims = (claimsByItem.get(item.id) ?? []).sort(
      (a, b) => indexOf.get(a.participant_id)! - indexOf.get(b.participant_id)!,
    );

    if (itemClaims.length === 0) {
      unclaimedIds.push(item.id);
      unclaimedSubtotal += item.total_price_paise;
      perItem.set(item.id, { totalShares: 0, claimantCount: 0, eachPaise: 0 });
      continue;
    }

    const shares = itemClaims.map((c) => Math.max(1, c.shares));
    const totalShares = shares.reduce((a, b) => a + b, 0);
    const amounts = largestRemainder(item.total_price_paise, shares);

    itemClaims.forEach((claim, i) => {
      const personIndex = indexOf.get(claim.participant_id)!;
      itemSubtotals[personIndex]! += amounts[i]!;
      perPersonItems[personIndex]!.push({
        itemId: item.id,
        name: item.name,
        myShares: shares[i]!,
        totalShares,
        amountPaise: amounts[i]!,
      });
    });

    perItem.set(item.id, {
      totalShares,
      claimantCount: itemClaims.length,
      // what one share costs — "₹X each" on the item row
      eachPaise: largestRemainder(item.total_price_paise, new Array(totalShares).fill(1))[0] ?? 0,
    });
  }

  // Charges ride along in proportion to what each person ate. The unclaimed
  // bucket is one more weight, so unclaimed food carries its own tax.
  const charges = netCharges(bill);
  const hasUnclaimed = unclaimedIds.length > 0;
  const chargeWeights = hasUnclaimed ? [...itemSubtotals, unclaimedSubtotal] : [...itemSubtotals];
  const chargeShares = largestRemainder(charges, chargeWeights);

  const peopleSplits: PersonSplit[] = people.map((person, i) => {
    const itemSubtotal = itemSubtotals[i]!;
    const chargeShare = chargeShares[i] ?? 0;
    return {
      participantId: person.id,
      displayName: person.display_name,
      isPayer: person.is_payer === 1,
      items: perPersonItems[i]!,
      itemSubtotalPaise: itemSubtotal,
      chargeSharePaise: chargeShare,
      totalPaise: itemSubtotal + chargeShare,
    };
  });

  const unclaimedCharge = hasUnclaimed ? chargeShares[chargeShares.length - 1]! : 0;

  return {
    people: peopleSplits,
    unclaimed: {
      itemIds: unclaimedIds,
      itemCount: unclaimedIds.length,
      itemSubtotalPaise: unclaimedSubtotal,
      chargeSharePaise: unclaimedCharge,
      totalPaise: unclaimedSubtotal + unclaimedCharge,
    },
    netChargesPaise: charges,
    grandTotalPaise:
      itemSubtotals.reduce((a, b) => a + b, 0) + unclaimedSubtotal + charges,
    perItem,
  };
}
