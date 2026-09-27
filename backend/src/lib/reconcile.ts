import type { GeminiBill, ScanResponse } from './scanSchema.js';

export const toPaise = (rupees: number | null | undefined): number =>
  rupees == null || !Number.isFinite(rupees) ? 0 : Math.round(rupees * 100);

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

export const formatPaise = (paise: number): string => inr.format(paise / 100);

/** Accepts what models actually emit (2026-09-27, 27/09/2026, 27-09-26) → ISO, or null. */
export function normaliseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return text;

  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(text);
  if (dmy) {
    const [, d, m, y] = dmy as unknown as [string, string, string, string];
    const year = y.length === 2 ? `20${y}` : y;
    const date = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return Number.isNaN(Date.parse(date)) ? null : date;
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

/**
 * Turns the model's rupee figures into integer paise and makes the bill
 * internally consistent, so the Review screen always shows arithmetic that
 * adds up (NFR-6/NFR-9). Anything we had to adjust becomes a visible warning
 * rather than a silent fix.
 */
export function reconcile(bill: GeminiBill): ScanResponse {
  const warnings: string[] = [];

  const items = bill.items.map((item) => {
    const totalPricePaise = toPaise(item.totalPrice);
    const quantity = Math.max(1, item.quantity ?? 1);
    const unitPricePaise =
      item.unitPrice != null ? toPaise(item.unitPrice) : Math.round(totalPricePaise / quantity);
    return { name: item.name.trim().slice(0, 80), quantity, unitPricePaise, totalPricePaise };
  });

  const itemsSum = items.reduce((sum, item) => sum + item.totalPricePaise, 0);

  let subtotalPaise = bill.subtotal != null ? toPaise(bill.subtotal) : itemsSum;
  if (subtotalPaise !== itemsSum) {
    warnings.push(
      `Items add up to ${formatPaise(itemsSum)} but the bill subtotal says ${formatPaise(subtotalPaise)}. Please check.`,
    );
    // The item list is what people claim, so it wins.
    subtotalPaise = itemsSum;
  }

  const taxPaise = toPaise(bill.tax);
  const serviceChargePaise = toPaise(bill.serviceCharge);
  const tipPaise = toPaise(bill.tip);
  const discountPaise = Math.abs(toPaise(bill.discount));
  let roundOffPaise = toPaise(bill.roundOff);

  const statedTotal = bill.total != null ? toPaise(bill.total) : null;
  const computedTotal =
    subtotalPaise + taxPaise + serviceChargePaise + tipPaise - discountPaise + roundOffPaise;

  let totalPaise = computedTotal;
  if (statedTotal != null && statedTotal !== computedTotal) {
    const gap = statedTotal - computedTotal;
    if (Math.abs(gap) <= 100) {
      // Within a rupee: this is the bill's own round-off line.
      roundOffPaise += gap;
      totalPaise = statedTotal;
    } else {
      warnings.push(
        `The bill total says ${formatPaise(statedTotal)} but the items and charges add up to ${formatPaise(computedTotal)}. Please check the items.`,
      );
      totalPaise = computedTotal;
    }
  }

  if (items.length === 0) warnings.push('We couldn’t read any items. Add them manually below.');

  return {
    restaurantName: bill.restaurantName?.trim() || null,
    billDate: normaliseDate(bill.billDate),
    items,
    subtotalPaise,
    taxPaise,
    serviceChargePaise,
    tipPaise,
    discountPaise,
    roundOffPaise,
    totalPaise,
    warnings,
  };
}
