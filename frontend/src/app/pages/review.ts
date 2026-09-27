import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api, identity } from '../core/api';
import type { DraftItem } from '../core/models';
import { paiseToRupees, rupeesToPaise } from '../core/money';
import { isValidUpiId } from '../core/upi';
import { RupeesPipe } from '../shared/rupees.pipe';

interface EditableItem {
  name: string;
  quantity: number;
  /** Rupees, because that is what people type. Converted to paise on save. */
  price: number;
}

@Component({
  selector: 'app-review',
  imports: [FormsModule, RupeesPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page stack-l">
      <header class="stack-s">
        <h1>Check the bill</h1>
        <p class="small muted">Fix anything that looks wrong. Nobody can claim until you open it.</p>
      </header>

      @if (loading()) {
        <div class="card stack-s">
          <div class="skeleton" style="height:20px;width:60%"></div>
          <div class="skeleton" style="height:44px"></div>
          <div class="skeleton" style="height:44px"></div>
        </div>
      } @else {
        @for (warning of warnings(); track warning) {
          <p class="banner banner-warn" role="status">⚠️ {{ warning }}</p>
        }

        <section class="card stack">
          <div>
            <label for="restaurant">Where was this?</label>
            <input id="restaurant" [ngModel]="restaurantName()" (ngModelChange)="restaurantName.set($event)"
                   name="restaurant" placeholder="Café Madras" />
          </div>
          <div>
            <label for="billDate">Date</label>
            <input id="billDate" type="date" name="billDate"
                   [ngModel]="billDate()" (ngModelChange)="billDate.set($event)" />
          </div>
        </section>

        <section class="stack-s">
          <div class="section-head">
            <h2>Items</h2>
            <span class="tiny dim">{{ items().length }} item{{ items().length === 1 ? '' : 's' }}</span>
          </div>

          @if (items().length) {
            <div class="item-row col-heads tiny dim" aria-hidden="true">
              <span>Item</span><span>Qty</span><span>Line total</span><span></span>
            </div>
          }

          @for (item of items(); track $index) {
            <div class="item-row">
              <input
                class="name" [(ngModel)]="item.name" [attr.aria-label]="'Item ' + ($index + 1) + ' name'"
                [name]="'name' + $index" placeholder="Item name" maxlength="80" (ngModelChange)="touch()" />
              <input
                class="qty" type="number" inputmode="numeric" min="1" step="1"
                [(ngModel)]="item.quantity" [name]="'qty' + $index"
                [attr.aria-label]="'Quantity for ' + item.name" (ngModelChange)="touch()" />
              <span class="money-input">
                <input
                  type="number" inputmode="decimal" min="0" step="0.01"
                  [(ngModel)]="item.price" [name]="'price' + $index"
                  [attr.aria-label]="'Total price for ' + item.name" (ngModelChange)="touch()" />
              </span>
              <button
                class="remove" type="button"
                [attr.aria-label]="'Remove ' + item.name" (click)="removeItem($index)">✕</button>
            </div>
          } @empty {
            <p class="banner banner-info">No items yet — add the first one below.</p>
          }

          <button class="btn btn-ghost btn-block" type="button" (click)="addItem()">+ Add item</button>
        </section>

        <section class="card stack">
          <h2>Taxes and charges</h2>
          @for (charge of chargeFields; track charge.key) {
            <div class="charge-row">
              <label [for]="charge.key">{{ charge.label }}</label>
              <span class="money-input">
                <input
                  [id]="charge.key" [name]="charge.key" type="number" inputmode="decimal" step="0.01"
                  [ngModel]="charges()[charge.key]"
                  (ngModelChange)="setCharge(charge.key, $event)" />
              </span>
            </div>
          }
          <p class="tiny dim">Combine CGST and SGST into one tax figure. Round off can be negative.</p>
        </section>

        <section class="card stack-s totals">
          <div class="row-between"><span class="muted small">Items</span><span class="money small">{{ subtotalPaise() | rupees }}</span></div>
          <div class="row-between"><span class="muted small">Taxes and charges</span><span class="money small">{{ netChargesPaise() | rupees }}</span></div>
          <hr class="divider" />
          <div class="row-between">
            <span class="strong">Grand total</span>
            <span class="big-money">{{ totalPaise() | rupees }}</span>
          </div>
        </section>

        <section class="card stack">
          <h2>Getting paid</h2>
          <div>
            <label for="payerName">Your name</label>
            <input id="payerName" name="payerName" maxlength="40" placeholder="Aarav"
                   [ngModel]="payerName()" (ngModelChange)="payerName.set($event)" />
          </div>
          <div>
            <label for="upi">Your UPI ID</label>
            <input
              id="upi" name="upi" [ngModel]="payerUpiId()" (ngModelChange)="payerUpiId.set($event)"
              [class.invalid]="upiTouched() && !upiValid()"
              (blur)="upiTouched.set(true)" placeholder="aarav&#64;okhdfcbank"
              autocapitalize="none" autocorrect="off" spellcheck="false" />
            @if (upiTouched() && !upiValid()) {
              <p class="field-error">Enter a UPI ID like name&#64;okhdfcbank</p>
            }
          </div>
          <p class="tiny dim">Friends get a Pay button with this ID and their exact amount filled in.</p>
        </section>

        @if (error(); as message) {
          <p class="banner banner-danger" role="alert">{{ message }}</p>
        }
      }
    </div>

    @if (!loading()) {
      <div class="sticky-bar">
        <div class="sticky-inner">
          <div class="grow">
            @if (blocker(); as reason) {
              <div class="tiny" style="color:var(--warn)">{{ reason }}</div>
            } @else {
              <div class="tiny dim">Total</div>
            }
            <div class="money">{{ totalPaise() | rupees }}</div>
          </div>
          <button class="btn btn-primary" type="button" [disabled]="!canOpen() || saving()" (click)="openForSplitting()">
            @if (saving()) { <span class="spinner"></span> }
            Open for splitting
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    .item-row {
      display: grid;
      grid-template-columns: 1fr 58px 96px 32px;
      gap: 8px;
      align-items: center;
    }
    .col-heads { padding: 0 2px; font-weight: 620; }
    .col-heads span:nth-child(2), .col-heads span:nth-child(3) { text-align: right; }

    .item-row input { min-height: 42px; padding: 8px 10px; }
    .item-row .qty { text-align: right; }

    .remove {
      width: 32px; height: 42px; padding: 0;
      background: none; border: 0; cursor: pointer;
      color: var(--ink-3); font-size: 0.9rem; border-radius: 8px;
      transition: color 140ms var(--ease), background 140ms var(--ease);
    }
    .remove:hover { color: var(--danger); background: var(--danger-soft); }

    .charge-row { display: grid; grid-template-columns: 1fr 124px; align-items: center; gap: 10px; }
    .charge-row label { margin: 0; }
    .charge-row input { min-height: 42px; }
  `,
})
export class ReviewPage {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly code = this.route.snapshot.paramMap.get('code')!;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly warnings = signal<string[]>([]);
  protected readonly upiTouched = signal(false);

  // Signals, not plain fields: a computed() over a plain property never
  // re-evaluates under zoneless change detection.
  protected readonly restaurantName = signal('');
  protected readonly billDate = signal('');
  protected readonly payerName = signal('');
  protected readonly payerUpiId = signal('');

  protected readonly items = signal<EditableItem[]>([]);
  protected readonly charges = signal({
    tax: 0,
    serviceCharge: 0,
    tip: 0,
    discount: 0,
    roundOff: 0,
  });

  protected readonly chargeFields = [
    { key: 'tax', label: 'Tax (GST)' },
    { key: 'serviceCharge', label: 'Service charge' },
    { key: 'tip', label: 'Tip' },
    { key: 'discount', label: 'Discount' },
    { key: 'roundOff', label: 'Round off' },
  ] as const;

  /** Bumped on every edit so the computed totals below recalculate. */
  private readonly revision = signal(0);

  protected readonly subtotalPaise = computed(() => {
    this.revision();
    return this.items().reduce((sum, item) => sum + rupeesToPaise(item.price), 0);
  });

  protected readonly netChargesPaise = computed(() => {
    const c = this.charges();
    return (
      rupeesToPaise(c.tax) +
      rupeesToPaise(c.serviceCharge) +
      rupeesToPaise(c.tip) -
      rupeesToPaise(c.discount) +
      rupeesToPaise(c.roundOff)
    );
  });

  protected readonly totalPaise = computed(() => this.subtotalPaise() + this.netChargesPaise());
  protected readonly upiValid = computed(() => isValidUpiId(this.payerUpiId()));
  /** Why "Open for splitting" is disabled — shown instead of leaving it a mystery. */
  protected readonly blocker = computed(() => {
    if (this.items().length === 0) return 'Add at least one item';
    if (!this.payerName().trim()) return 'Add your name below';
    if (!this.upiValid()) return 'Add a valid UPI ID below';
    return null;
  });

  protected readonly canOpen = computed(
    () => this.items().length > 0 && this.payerName().trim().length > 0 && this.upiValid(),
  );

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const stored = sessionStorage.getItem(`scan-warnings:${this.code}`);
      if (stored) {
        this.warnings.set(JSON.parse(stored) as string[]);
        sessionStorage.removeItem(`scan-warnings:${this.code}`);
      }

      const { bill, items } = await this.api.getBill(this.code);

      if (bill.status !== 'draft') {
        await this.router.navigate(['/b', this.code]);
        return;
      }

      this.restaurantName.set(bill.restaurant_name ?? '');
      this.billDate.set(bill.bill_date ?? new Date().toISOString().slice(0, 10));
      // Pre-fill from the payer's last bill so they type the UPI ID once.
      this.payerName.set(bill.payer_name || localStorage.getItem('ss:payerName') || identity.name());
      this.payerUpiId.set(bill.payer_upi_id || localStorage.getItem('ss:payerUpiId') || '');

      this.charges.set({
        tax: paiseToRupees(bill.tax_paise),
        serviceCharge: paiseToRupees(bill.service_charge_paise),
        tip: paiseToRupees(bill.tip_paise),
        discount: paiseToRupees(bill.discount_paise),
        roundOff: paiseToRupees(bill.round_off_paise),
      });

      this.items.set(
        items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          price: paiseToRupees(item.total_price_paise),
        })),
      );
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Couldn’t load this bill.');
    } finally {
      this.loading.set(false);
    }
  }

  protected touch(): void {
    this.revision.update((n) => n + 1);
  }

  protected setCharge(key: (typeof this.chargeFields)[number]['key'], value: number): void {
    this.charges.update((current) => ({ ...current, [key]: Number(value) || 0 }));
  }

  protected addItem(): void {
    this.items.update((list) => [...list, { name: '', quantity: 1, price: 0 }]);
    this.touch();
  }

  protected removeItem(index: number): void {
    this.items.update((list) => list.filter((_, i) => i !== index));
    this.touch();
  }

  protected async openForSplitting(): Promise<void> {
    if (!this.canOpen() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);

    try {
      const draftItems: DraftItem[] = this.items().map((item) => {
        const totalPricePaise = rupeesToPaise(item.price);
        const quantity = Math.max(1, Math.round(Number(item.quantity) || 1));
        return {
          name: item.name.trim() || 'Item',
          quantity,
          unitPricePaise: Math.round(totalPricePaise / quantity),
          totalPricePaise,
        };
      });

      const c = this.charges();
      await this.api.saveBill(this.code, {
        title: this.restaurantName().trim() || 'Bill',
        restaurantName: this.restaurantName().trim() || null,
        billDate: this.billDate() || null,
        payerName: this.payerName().trim(),
        payerUpiId: this.payerUpiId().trim(),
        charges: {
          taxPaise: rupeesToPaise(c.tax),
          serviceChargePaise: rupeesToPaise(c.serviceCharge),
          tipPaise: rupeesToPaise(c.tip),
          discountPaise: rupeesToPaise(c.discount),
          roundOffPaise: rupeesToPaise(c.roundOff),
        },
        items: draftItems,
      });

      localStorage.setItem('ss:payerName', this.payerName().trim());
      localStorage.setItem('ss:payerUpiId', this.payerUpiId().trim());
      identity.setName(this.payerName().trim());

      await this.api.openBill(this.code);
      await this.router.navigate(['/b', this.code]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Couldn’t open the bill.');
    } finally {
      this.saving.set(false);
    }
  }
}
