import { paiseToAmountString } from './money';

/** name@bank — deliberately permissive, since bank handles keep being added. */
const VPA = /^[a-zA-Z0-9.\-_]{1,256}@[a-zA-Z][a-zA-Z0-9.\-_]{1,64}$/;

export const isValidUpiId = (vpa: string): boolean => VPA.test(vpa.trim());

export interface UpiLinkInput {
  payeeUpiId: string;
  payeeName: string;
  amountPaise: number;
  note?: string;
}

/**
 * Builds a `upi://pay` intent. Every value is percent-encoded, so a payee
 * called "Raj & Co" or a note with spaces can't break the query string.
 */
export function buildUpiLink({ payeeUpiId, payeeName, amountPaise, note }: UpiLinkInput): string {
  if (!isValidUpiId(payeeUpiId)) throw new Error('Invalid UPI ID');

  const params = new URLSearchParams();
  params.set('pa', payeeUpiId.trim());
  params.set('pn', payeeName.trim() || 'Payee');
  params.set('am', paiseToAmountString(amountPaise));
  params.set('cu', 'INR');
  if (note) params.set('tn', note.slice(0, 50));

  // URLSearchParams encodes spaces as "+", which UPI apps read literally.
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

export const upiNote = (restaurant: string | null | undefined): string =>
  restaurant ? `Smart Splitter - ${restaurant}` : 'Smart Splitter';
