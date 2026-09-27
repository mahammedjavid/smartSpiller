import { describe, expect, it } from 'vitest';
import { buildUpiLink, isValidUpiId, upiNote } from './upi';
import { formatPaise, paiseToAmountString, rupeesToPaise } from './money';

describe('isValidUpiId', () => {
  it('accepts real-world VPAs', () => {
    for (const vpa of ['aarav@okhdfcbank', 'raj.kumar-1@ybl', '9876543210@paytm', 'a_b@upi']) {
      expect(isValidUpiId(vpa), vpa).toBe(true);
    }
  });

  it('rejects malformed ones', () => {
    for (const vpa of ['', 'aarav', 'aarav@', '@okhdfcbank', 'aarav@@ybl', 'aarav bank@ybl', 'a@1bank']) {
      expect(isValidUpiId(vpa), vpa).toBe(false);
    }
  });
});

describe('buildUpiLink', () => {
  it('builds a link with the amount to two decimals', () => {
    const link = buildUpiLink({
      payeeUpiId: 'aarav@okhdfcbank',
      payeeName: 'Aarav',
      amountPaise: 40700,
      note: 'Smart Splitter - Cafe Madras',
    });
    expect(link).toBe(
      'upi://pay?pa=aarav%40okhdfcbank&pn=Aarav&am=407.00&cu=INR&tn=Smart%20Splitter%20-%20Cafe%20Madras',
    );
  });

  it('encodes spaces as %20 rather than +, which UPI apps read literally', () => {
    const link = buildUpiLink({ payeeUpiId: 'a@ybl', payeeName: 'Raj Kumar', amountPaise: 100 });
    expect(link).toContain('pn=Raj%20Kumar');
    expect(link).not.toContain('+');
  });

  it('escapes an ampersand in the payee name so the query string survives', () => {
    const link = buildUpiLink({ payeeUpiId: 'a@ybl', payeeName: 'Raj & Co', amountPaise: 5000 });
    expect(link).toContain('pn=Raj%20%26%20Co');
    expect(new URLSearchParams(link.split('?')[1]).get('pn')).toBe('Raj & Co');
  });

  it('caps the note at the 50 characters UPI apps accept', () => {
    const link = buildUpiLink({
      payeeUpiId: 'a@ybl',
      payeeName: 'A',
      amountPaise: 100,
      note: 'x'.repeat(120),
    });
    expect(new URLSearchParams(link.split('?')[1]).get('tn')).toHaveLength(50);
  });

  it('refuses an invalid VPA instead of producing a dead link', () => {
    expect(() => buildUpiLink({ payeeUpiId: 'nope', payeeName: 'A', amountPaise: 100 })).toThrow();
  });

  it('names the restaurant in the note when there is one', () => {
    expect(upiNote('Cafe Madras')).toBe('Smart Splitter - Cafe Madras');
    expect(upiNote(null)).toBe('Smart Splitter');
  });
});

describe('money', () => {
  it('formats paise the Indian way', () => {
    expect(formatPaise(123450)).toBe('₹1,234.50');
    expect(formatPaise(0)).toBe('₹0.00');
    expect(formatPaise(100000000)).toBe('₹10,00,000.00');
  });

  it('renders a plain amount for UPI', () => {
    expect(paiseToAmountString(40700)).toBe('407.00');
    expect(paiseToAmountString(5)).toBe('0.05');
  });

  it('parses typed rupees into integer paise', () => {
    expect(rupeesToPaise('1,234.50')).toBe(123450);
    expect(rupeesToPaise('₹99')).toBe(9900);
    expect(rupeesToPaise('')).toBe(0);
    expect(rupeesToPaise('abc')).toBe(0);
    expect(rupeesToPaise(19.99)).toBe(1999);
  });
});
