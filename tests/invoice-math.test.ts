import { describe, expect, it } from 'vitest';

/** Mirrors the totals produced by public.create_invoice(). */
interface Line { quantity: number; unitPrice: number; discount?: number; taxRate?: number }

function invoiceTotals(lines: Line[], invoiceDiscount = 0) {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const lineSub = Math.max(0, l.quantity * l.unitPrice - (l.discount ?? 0));
    subtotal += lineSub;
    tax += (lineSub * (l.taxRate ?? 0)) / 100;
  }
  subtotal = round(subtotal);
  tax = round(tax);
  const disc = round(Math.min(invoiceDiscount, subtotal));
  const total = round(Math.max(0, subtotal - disc + tax));
  return { subtotal, tax, discount: disc, total };
}

const round = (n: number) => Math.round(n * 100) / 100;

describe('invoice totals', () => {
  it('sums simple lines', () => {
    expect(invoiceTotals([{ quantity: 2, unitPrice: 15 }]).total).toBe(30);
  });

  it('applies line-level tax', () => {
    const r = invoiceTotals([{ quantity: 1, unitPrice: 100, taxRate: 14 }]);
    expect(r.tax).toBe(14);
    expect(r.total).toBe(114);
  });

  it('applies invoice-level discount before tax addition', () => {
    const r = invoiceTotals([{ quantity: 1, unitPrice: 100 }], 20);
    expect(r.subtotal).toBe(100);
    expect(r.discount).toBe(20);
    expect(r.total).toBe(80);
  });

  it('never allows a discount larger than the subtotal', () => {
    const r = invoiceTotals([{ quantity: 1, unitPrice: 50 }], 500);
    expect(r.discount).toBe(50);
    expect(r.total).toBe(0);
  });

  it('keeps totals non-negative with a full line discount', () => {
    const r = invoiceTotals([{ quantity: 1, unitPrice: 50, discount: 60 }]);
    expect(r.subtotal).toBe(0);
    expect(r.total).toBe(0);
  });

  it('avoids floating point drift', () => {
    const r = invoiceTotals([{ quantity: 3, unitPrice: 0.1 }]);
    expect(r.total).toBe(0.3);
  });

  it('computes balance from paid amount', () => {
    const total = invoiceTotals([{ quantity: 1, unitPrice: 120 }]).total;
    const balance = round(total - 70);
    expect(balance).toBe(50);
  });
});
