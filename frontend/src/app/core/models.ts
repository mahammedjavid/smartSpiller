export type BillStatus = 'draft' | 'open' | 'settled';
export type PaymentStatus = 'pending' | 'marked_paid' | 'confirmed';

export interface Bill {
  code: string;
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
  status: BillStatus;
  source: 'scan' | 'manual';
  created_at: string;
}

export interface BillItem {
  id: string;
  name: string;
  quantity: number;
  unit_price_paise: number;
  total_price_paise: number;
  position: number;
}

export interface Participant {
  id: string;
  display_name: string;
  /** SQLite stores this as 0/1; the split engine only reads it for truthiness. */
  is_payer: number;
  payment_status: PaymentStatus;
  amount_due_paise: number;
  created_at: string;
}

export interface ItemClaim {
  item_id: string;
  participant_id: string;
  shares: number;
}

/** Everything the bill room needs, in one object — what every read and every push returns. */
export interface BillState {
  bill: Bill;
  items: BillItem[];
  participants: Participant[];
  claims: ItemClaim[];
}

export interface DraftItem {
  name: string;
  quantity: number;
  unitPricePaise: number;
  totalPricePaise: number;
}

/** Response from POST /api/scan. */
export interface ScanResult {
  restaurantName: string | null;
  billDate: string | null;
  items: DraftItem[];
  subtotalPaise: number;
  taxPaise: number;
  serviceChargePaise: number;
  tipPaise: number;
  discountPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  warnings: string[];
}
