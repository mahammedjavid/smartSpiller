const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹1,234.50 — the only place money becomes a string (NFR-8). */
export const formatPaise = (paise: number): string => INR.format(paise / 100);

/** "407.00" — the plain amount a UPI link needs. */
export const paiseToAmountString = (paise: number): string => (paise / 100).toFixed(2);

/** Parses what a person types into an input, in rupees, to integer paise. */
export function rupeesToPaise(input: string | number | null | undefined): number {
  if (input == null || input === '') return 0;
  const value = typeof input === 'number' ? input : Number(String(input).replace(/[₹,\s]/g, ''));
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/** Fills a rupee input from stored paise without introducing float noise. */
export const paiseToRupees = (paise: number): number => Number((paise / 100).toFixed(2));
