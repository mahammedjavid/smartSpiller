import { z } from 'zod';

/**
 * What we ask Gemini for. Rupee amounts, because asking a model for paise
 * invites off-by-100 errors — we convert to integer paise ourselves.
 */
export const geminiBillSchema = z.object({
  isBill: z.boolean(),
  restaurantName: z.string().nullable().optional(),
  billDate: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        quantity: z.number().int().min(1).max(999).default(1),
        unitPrice: z.number().min(0).nullable().optional(),
        totalPrice: z.number().min(0),
      }),
    )
    .default([]),
  subtotal: z.number().nullable().optional(),
  tax: z.number().nullable().optional(),
  serviceCharge: z.number().nullable().optional(),
  tip: z.number().nullable().optional(),
  discount: z.number().nullable().optional(),
  roundOff: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
});

export type GeminiBill = z.infer<typeof geminiBillSchema>;

/** The shape the Angular Review screen consumes — Section 12 of the PRD. */
export interface ScanResponse {
  restaurantName: string | null;
  billDate: string | null;
  items: Array<{
    name: string;
    quantity: number;
    unitPricePaise: number;
    totalPricePaise: number;
  }>;
  subtotalPaise: number;
  taxPaise: number;
  serviceChargePaise: number;
  tipPaise: number;
  discountPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  warnings: string[];
}
