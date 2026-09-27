import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { environment } from '../../environments/environment';
import { Api, identity } from '../core/api';
import type { BillItem, BillState } from '../core/models';
import { computeSplit, type ItemBreakdown, type PersonSplit } from '../core/split';
import { buildUpiLink, upiNote } from '../core/upi';
import { copyText, shareOrWhatsApp } from '../shared/copy';
import { QrCodeComponent } from '../shared/qr-code';
import { RupeesPipe } from '../shared/rupees.pipe';

@Component({
  selector: 'app-bill-room',
  imports: [FormsModule, RouterLink, QrCodeComponent, RupeesPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page stack">
      @if (loadError(); as message) {
        <div class="card stack center">
          <p class="banner banner-danger">{{ message }}</p>
          <a class="btn btn-ghost" routerLink="/">Go to Smart Splitter</a>
        </div>
      } @else if (!state()) {
        <div class="card stack-s">
          <div class="skeleton" style="height:24px;width:55%"></div>
          <div class="skeleton" style="height:56px"></div>
          <div class="skeleton" style="height:56px"></div>
        </div>
      } @else {
        @let bill = state()!.bill;

        <header class="masthead">
          <div class="row-between">
            <div class="grow">
              <h1 class="truncate">{{ bill.restaurant_name || bill.title }}</h1>
              <p class="tiny dim">
                {{ participants().length }} {{ participants().length === 1 ? 'person' : 'people' }}
                · {{ items().length }} items
                @if (bill.bill_date) { · {{ dateLabel(bill.bill_date) }} }
              </p>
            </div>
            <div class="bill-total">
              <span class="tiny dim">Bill total</span>
              <span class="big-money">{{ bill.total_paise | rupees }}</span>
            </div>
          </div>

          <div class="row wrap">
            <span class="chip" [class.chip-brand]="bill.status === 'open'"
                  [class.chip-ok]="bill.status === 'settled'">{{ statusLabel() }}</span>
            <span class="chip" [class.chip-ok]="live()" [class.chip-warn]="!live()">
              <span class="pulse-dot"></span>{{ live() ? 'Live' : 'Reconnecting' }}
            </span>
            @if (!live()) {
              <button class="btn-link small" type="button" (click)="refresh()">Refresh now</button>
            }
          </div>
        </header>

        <!-- ── not joined yet ─────────────────────────── -->
        @if (!me() && bill.status === 'open') {
          <form class="card stack" (ngSubmit)="joinNow()">
            <h2>Tap in to claim your items</h2>
            <div>
              <label for="myName">Your name</label>
              <input id="myName" name="myName" [(ngModel)]="myName" maxlength="40" placeholder="Bhavna" />
            </div>
            <button class="btn btn-primary btn-block" type="submit" [disabled]="!myName.trim() || working()">
              Join this split
            </button>
          </form>
        }

        <!-- ── your share, front and centre ───────────── -->
        @if (me() && !isPayer()) {
          <section class="hero-card">
            <span class="tiny" style="opacity:.75">Your share</span>
            <span class="hero-money">{{ myTotalPaise() | rupees }}</span>
            <span class="tiny" style="opacity:.75">
              @if (myItemCount() === 0) { Nothing picked yet — tap the dishes you had }
              @else { {{ myItemCount() }} item{{ myItemCount() === 1 ? '' : 's' }}
                      · incl. {{ mySplit()!.chargeSharePaise | rupees }} tax and charges }
            </span>
          </section>
        }

        <!-- ── payer: share ───────────────────────────── -->
        @if (isPayer()) {
          <section class="card stack" [class.compact]="guestCount() > 0 && !shareOpen()">
            @if (guestCount() > 0 && !shareOpen()) {
              <button class="row share-collapsed" type="button" (click)="shareOpen.set(true)">
                <span class="grow row">
                  <span class="chip chip-brand">{{ bill.code }}</span>
                  <span class="small muted">{{ guestCount() }} joined</span>
                </span>
                <span class="btn btn-sm btn-ghost">Show QR</span>
              </button>
            } @else {
              <div class="stack center">
                <h2>Let everyone in</h2>
                <p class="small muted">Scan this, or share the link</p>
                <div class="qr-frame">
                  <app-qr-code [value]="shareUrl()" [size]="172" alt="QR code to join this bill" />
                </div>
                <code class="share-code">{{ bill.code }}</code>
                <div class="row wrap" style="justify-content:center">
                  <button class="btn btn-sm btn-soft" type="button" (click)="copyLink()">
                    {{ copied() ? '✓ Copied' : 'Copy link' }}
                  </button>
                  <button class="btn btn-sm btn-ghost" type="button" (click)="share()">Share</button>
                  @if (guestCount() > 0) {
                    <button class="btn btn-sm btn-ghost" type="button" (click)="shareOpen.set(false)">Hide</button>
                  }
                </div>
              </div>
            }
          </section>

          @if (split().unclaimed.itemCount > 0) {
            <div class="banner banner-warn row wrap">
              <span class="grow strong small">
                {{ split().unclaimed.itemCount }} unclaimed
                · {{ split().unclaimed.totalPaise | rupees }}
              </span>
              <button class="btn btn-sm btn-ghost" type="button" (click)="splitLeftovers()" [disabled]="working()">
                Split equally
              </button>
            </div>
          }
        }

        <!-- ── items ──────────────────────────────────── -->
        <section class="stack-s">
          <div class="section-head">
            <h2>{{ isPayer() ? 'The bill' : 'Tap what you had' }}</h2>
            <span class="tiny dim">{{ items().length }} items</span>
          </div>

          @for (item of items(); track item.id) {
            @let claimants = claimantsOf(item.id);
            @let mine = isMine(item.id);
            <div class="card-flat item" [class.mine]="mine" [class.unclaimed]="!claimants.length">
              <button class="item-main" type="button" [disabled]="!canClaim()"
                      [attr.aria-pressed]="mine" (click)="toggleClaim(item)">
                @if (canClaim()) {
                  <span class="tick" [class.on]="mine" aria-hidden="true">{{ mine ? '✓' : '' }}</span>
                }
                <span class="stack-s grow">
                  <span class="row">
                    <span class="strong truncate">{{ item.name }}</span>
                    @if (item.quantity > 1) { <span class="chip chip-quiet">×{{ item.quantity }}</span> }
                  </span>
                  @let info = breakdown(item.id);
                  <span class="row wrap tiny muted">
                    @for (person of claimants; track person.id) {
                      <span class="avatar" [class.avatar-brand]="person.id === me()"
                            [title]="person.display_name">{{ initials(person.display_name) }}</span>
                    }
                    @if (item.quantity > 1 && !info.shared) {
                      <span class="nowrap">{{ info.claimedShares }} of {{ item.quantity }} taken</span>
                      <span class="nowrap">{{ info.eachPaise | rupees }} each</span>
                    } @else if (claimants.length > 1) {
                      <span>{{ info.eachPaise | rupees }} each</span>
                    } @else if (!claimants.length) {
                      <span class="dim">Nobody yet</span>
                    }
                    @if (info.unclaimedUnits > 0 && claimants.length) {
                      <span class="chip chip-warn">{{ info.unclaimedUnits }} left</span>
                    }
                  </span>
                </span>
                <span class="money">{{ item.total_price_paise | rupees }}</span>
              </button>

              @if (mine && item.quantity > 1 && canClaim()) {
                <div class="row stepper">
                  <span class="tiny muted grow">How many did you have?</span>
                  <button class="btn btn-sm btn-ghost" type="button" aria-label="One share fewer"
                          [disabled]="myShares(item.id) <= 1" (click)="changeShares(item, -1)">−</button>
                  <span class="strong" style="min-width:1.5ch;text-align:center">{{ myShares(item.id) }}</span>
                  <button class="btn btn-sm btn-ghost" type="button" aria-label="One share more"
                          [disabled]="myShares(item.id) >= item.quantity" (click)="changeShares(item, 1)">+</button>
                </div>
              }
            </div>
          }
        </section>

        <!-- ── people ─────────────────────────────────── -->
        <section class="stack-s">
          <div class="section-head">
            <h2>Who owes what</h2>
            @if (isPayer()) { <span class="tiny dim">{{ paidCount() }}/{{ owingCount() }} settled</span> }
          </div>
          @for (person of split().people; track person.participantId) {
            @let record = participantById(person.participantId);
            <div class="card-flat stack-s person" [class.mine]="person.participantId === me()">
              <div class="row-between">
                <span class="row grow">
                  <span class="avatar avatar-lg" [class.avatar-brand]="person.participantId === me()">{{ initials(person.displayName) }}</span>
                  <span class="truncate strong">{{ person.displayName }}</span>
                  @if (person.isPayer) { <span class="chip chip-brand">paid the bill</span> }
                  @else if (record?.payment_status === 'confirmed') { <span class="chip chip-ok">✓ confirmed</span> }
                  @else if (record?.payment_status === 'marked_paid') { <span class="chip chip-warn">says paid</span> }
                </span>
                <span class="money">{{ person.totalPaise | rupees }}</span>
              </div>

              <p class="tiny dim">
                Food {{ person.itemSubtotalPaise | rupees }} · charges {{ person.chargeSharePaise | rupees }}
              </p>

              @if (isPayer() && !person.isPayer) {
                <div class="row wrap">
                  @if (record?.payment_status === 'confirmed') {
                    <button class="btn btn-sm btn-ghost" type="button" [disabled]="working()"
                            (click)="setStatus(person, 'pending')">Undo</button>
                  } @else {
                    <button class="btn btn-sm" type="button" [disabled]="working()"
                            [class.btn-primary]="record?.payment_status === 'marked_paid'"
                            [class.btn-ghost]="record?.payment_status !== 'marked_paid'"
                            (click)="setStatus(person, 'confirmed')">
                      {{ record?.payment_status === 'marked_paid' ? 'Confirm received' : 'Mark received' }}
                    </button>
                    <button class="btn btn-sm btn-ghost" type="button" (click)="copyNudge(person)">
                      {{ nudged() === person.participantId ? '✓ Copied' : 'Copy reminder' }}
                    </button>
                  }
                </div>
              }
            </div>
          }

          @if (isPayer() && bill.status === 'open') {
            <form class="row" (ngSubmit)="addOffline()">
              <input class="grow" [(ngModel)]="offlineName" name="offlineName" maxlength="40"
                     placeholder="Add a friend without a phone" aria-label="Name of a friend to add" />
              <button class="btn btn-ghost" type="submit" [disabled]="!offlineName.trim() || working()">Add</button>
            </form>
          }
        </section>

        @if (actionError(); as message) {
          <p class="banner banner-danger" role="alert">{{ message }}</p>
        }

        @if (isPayer()) {
          <section class="card stack">
            <div class="row-between">
              <div>
                <span class="tiny dim">Collected</span>
                <div class="big-money">{{ receivedPaise() | rupees }}</div>
              </div>
              <div style="text-align:right">
                <span class="tiny dim">Owed to you</span>
                <div class="money">{{ owedPaise() | rupees }}</div>
              </div>
            </div>
            <div class="meter" role="img"
                 [attr.aria-label]="paidCount() + ' of ' + owingCount() + ' people have paid'">
              <div class="meter-fill" [style.width.%]="collectedPercent()"></div>
            </div>
            <p class="tiny dim">Payments are self-reported — Smart Splitter doesn't check with your bank.</p>
            @if (bill.status === 'open') {
              <button class="btn btn-ghost btn-block" type="button" [disabled]="working()" (click)="settle()">
                Mark this bill settled
              </button>
            }
          </section>
        }
      }
    </div>

    <!-- ── guest: sticky pay bar ──────────────────────── -->
    @if (state() && me() && !isPayer()) {
      <div class="sticky-bar">
        <div class="sticky-inner">
          @if (myRecord()?.payment_status === 'pending') {
            <button class="btn btn-primary btn-block" type="button" [disabled]="myTotalPaise() <= 0"
                    (click)="showPaySheet.set(true)">
              @if (myTotalPaise() > 0) { Pay {{ myTotalPaise() | rupees }} }
              @else { Tap the dishes you had }
            </button>
          } @else {
            <span class="grow row">
              <span class="chip" [class.chip-ok]="myRecord()?.payment_status === 'confirmed'"
                    [class.chip-warn]="myRecord()?.payment_status === 'marked_paid'">
                {{ myRecord()?.payment_status === 'confirmed' ? '✓ Confirmed' : 'Waiting for confirmation' }}
              </span>
            </span>
            <button class="btn btn-ghost" type="button" [disabled]="working()" (click)="markPaid(false)">Undo</button>
          }
        </div>
      </div>
    }

    <!-- ── guest: pay sheet ───────────────────────────── -->
    @if (showPaySheet() && state()) {
      @let bill = state()!.bill;
      <div class="overlay" role="dialog" aria-modal="true" aria-label="Pay your share">
        <div class="sheet stack">
          <div class="row-between">
            <h2>Pay {{ bill.payer_name || 'the payer' }}</h2>
            <button class="btn-link" type="button" (click)="showPaySheet.set(false)">Close</button>
          </div>
          <p class="big-money center">{{ myTotalPaise() | rupees }}</p>

          @if (upiLink(); as link) {
            <div class="center"><app-qr-code [value]="link" [size]="190" alt="UPI QR code for your share" /></div>
            <a class="btn btn-primary btn-block" [href]="link">Open my UPI app</a>
            <button class="btn btn-ghost btn-block" type="button" (click)="copyUpiId()">
              {{ copiedUpi() ? '✓ Copied' : 'Copy UPI ID: ' + bill.payer_upi_id }}
            </button>
          } @else {
            <p class="banner banner-warn">The payer hasn't added a valid UPI ID yet.</p>
          }

          <button class="btn btn-primary btn-block" type="button" [disabled]="working()" (click)="markPaid(true)">
            I've paid
          </button>
          <p class="tiny dim center">
            We can't check with your bank — this just tells {{ bill.payer_name || 'the payer' }}.
          </p>
        </div>
      </div>
    }
  `,
  styles: `
    .masthead { display: flex; flex-direction: column; gap: 10px; padding: 4px 2px 0; }
    .bill-total { display: flex; flex-direction: column; align-items: flex-end; flex: none; }

    /* the guest's own number, stated once and loudly */
    .hero-card {
      display: flex; flex-direction: column; gap: 3px;
      background: var(--brand); color: var(--brand-ink);
      border-radius: var(--r-lg); padding: 18px;
      box-shadow: var(--shadow-2);
    }

    .qr-frame { background: #fff; padding: 12px; border-radius: var(--r); line-height: 0; }
    .share-code {
      font-size: 1.1875rem; letter-spacing: 0.2em; font-weight: 700;
      color: var(--ink-2); padding-left: 0.2em;
    }
    .share-collapsed {
      width: 100%; min-height: var(--tap);
      background: none; border: 0; padding: 0;
      font: inherit; color: inherit; cursor: pointer; text-align: left;
    }
    .card.compact { padding: 10px 12px; }

    /* ── item rows ── */
    .item { padding: 0; overflow: hidden; transition: border-color 140ms var(--ease), background 140ms var(--ease); }
    .item.unclaimed { border-style: dashed; }
    .item.mine { border-color: var(--brand-line); background: var(--brand-soft); border-style: solid; }
    .item-main {
      display: flex; align-items: center; gap: 12px; width: 100%;
      min-height: 62px; padding: 12px 14px;
      background: none; border: 0; font: inherit; color: inherit;
      text-align: left; cursor: pointer;
    }
    .item-main:disabled { cursor: default; }
    .item-main:active:not(:disabled) { background: color-mix(in srgb, var(--brand) 8%, transparent); }

    .tick {
      width: 22px; height: 22px; flex: none;
      border-radius: 7px; border: 1.5px solid var(--line-strong);
      display: grid; place-items: center;
      font-size: 0.75rem; font-weight: 800; color: transparent;
      transition: all 140ms var(--ease);
    }
    .tick.on { background: var(--brand); border-color: var(--brand); color: var(--brand-ink); }

    .stepper { padding: 0 14px 12px; }

    /* each fact stays on one line, and they separate themselves visually
       instead of relying on a bullet that can strand at a line break */
    .nowrap { white-space: nowrap; }
    .nowrap + .nowrap::before { content: '·'; color: var(--ink-3); margin-right: 6px; }

    .person.mine { border-color: var(--brand-line); background: var(--brand-soft); }

    /* collection progress */
    .meter { height: 7px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
    .meter-fill {
      height: 100%; border-radius: 999px; background: var(--brand);
      transition: width 320ms var(--ease); min-width: 0;
    }

    /* ── pay sheet ── */
    .overlay {
      position: fixed; inset: 0; z-index: 40;
      background: rgb(8 12 16 / 55%);
      backdrop-filter: blur(3px);
      display: flex; align-items: flex-end; justify-content: center;
      animation: fade 160ms var(--ease);
    }
    @keyframes fade { from { opacity: 0; } }
    .sheet {
      width: 100%; max-width: 520px; background: var(--surface);
      border-radius: var(--r-lg) var(--r-lg) 0 0;
      padding: 20px 16px calc(24px + env(safe-area-inset-bottom));
      max-height: 90vh; overflow-y: auto;
      animation: rise 220ms var(--ease);
    }
    @keyframes rise { from { transform: translateY(14px); } }
    @media (min-width: 560px) {
      .overlay { align-items: center; }
      .sheet { border-radius: var(--r-lg); margin: 16px; animation: fade 160ms var(--ease); }
    }
  `,
})
export class BillRoomPage {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly code = (this.route.snapshot.paramMap.get('code') ?? '').toUpperCase();

  protected readonly state = signal<BillState | null>(null);
  protected readonly live = signal(false);
  protected readonly working = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly me = signal<string | null>(identity.participantId(this.code));

  protected readonly copied = signal(false);
  protected readonly copiedUpi = signal(false);
  protected readonly nudged = signal<string | null>(null);
  protected readonly showPaySheet = signal(false);
  /** The QR card folds away once people have joined; it's only needed up front. */
  protected readonly shareOpen = signal(false);
  protected offlineName = '';
  protected myName = identity.name();

  protected readonly items = computed(() => this.state()?.items ?? []);
  protected readonly participants = computed(() => this.state()?.participants ?? []);
  protected readonly claims = computed(() => this.state()?.claims ?? []);

  /** Holding the owner token is what makes you the payer — there is no account. */
  protected readonly isPayer = computed(
    () => !!this.state() && identity.ownerToken(this.code) !== null,
  );

  protected readonly split = computed(() =>
    computeSplit(
      this.state()?.bill ?? {
        tax_paise: 0, service_charge_paise: 0, tip_paise: 0, discount_paise: 0, round_off_paise: 0,
      },
      this.items(),
      this.participants(),
      this.claims(),
    ),
  );

  protected readonly mySplit = computed<PersonSplit | null>(() => {
    const id = this.me();
    return id ? this.split().people.find((p) => p.participantId === id) ?? null : null;
  });

  protected readonly myRecord = computed(() =>
    this.participants().find((p) => p.id === this.me()) ?? null,
  );

  protected readonly myTotalPaise = computed(() => this.mySplit()?.totalPaise ?? 0);
  protected readonly myItemCount = computed(() => this.mySplit()?.items.length ?? 0);
  protected readonly canClaim = computed(
    () => this.state()?.bill.status === 'open' && this.me() !== null,
  );

  protected readonly shareUrl = computed(() => `${environment.appBaseUrl}/j/${this.code}`);

  /** Everyone except the payer — i.e. how many people have actually joined. */
  protected readonly guestCount = computed(
    () => this.participants().filter((p) => !p.is_payer).length,
  );

  protected readonly collectedPercent = computed(() => {
    const owed = this.owedPaise();
    return owed <= 0 ? 0 : Math.round((this.receivedPaise() / owed) * 100);
  });

  protected readonly statusLabel = computed(() => {
    const status = this.state()?.bill.status;
    return status === 'open' ? 'Open' : status === 'settled' ? 'Settled' : 'Draft';
  });

  protected readonly upiLink = computed(() => {
    const bill = this.state()?.bill;
    const amount = this.myTotalPaise();
    if (!bill || amount <= 0) return null;
    try {
      return buildUpiLink({
        payeeUpiId: bill.payer_upi_id,
        payeeName: bill.payer_name,
        amountPaise: amount,
        note: upiNote(bill.restaurant_name),
      });
    } catch {
      return null; // no usable UPI ID yet
    }
  });

  private readonly owing = computed(() => this.split().people.filter((p) => !p.isPayer));
  protected readonly owingCount = computed(() => this.owing().length);
  protected readonly owedPaise = computed(() => this.owing().reduce((sum, p) => sum + p.totalPaise, 0));
  private readonly confirmed = computed(() =>
    this.owing().filter((p) => this.participantById(p.participantId)?.payment_status === 'confirmed'),
  );
  protected readonly paidCount = computed(() => this.confirmed().length);
  protected readonly receivedPaise = computed(() =>
    this.confirmed().reduce((sum, p) => sum + p.totalPaise, 0),
  );

  constructor() {
    void this.refresh();

    // The server pushes the whole room on every change, so this is the only
    // update path once connected; refresh() is just the manual fallback.
    const close = this.api.stream(
      this.code,
      (state) => {
        this.state.set(state);
        this.loadError.set(null);
      },
      (connected) => this.live.set(connected),
    );
    this.destroyRef.onDestroy(close);
  }

  protected async refresh(): Promise<void> {
    try {
      this.state.set(await this.api.getBill(this.code));
      this.loadError.set(null);
    } catch (error) {
      if (!this.state()) {
        this.loadError.set(error instanceof Error ? error.message : 'Couldn’t load this bill.');
      }
    }
  }

  // ── template helpers ──────────────────────────────────────
  protected participantById(id: string) {
    return this.participants().find((p) => p.id === id);
  }

  protected claimantsOf(itemId: string) {
    const ids = new Set(this.claims().filter((c) => c.item_id === itemId).map((c) => c.participant_id));
    return this.participants().filter((p) => ids.has(p.id));
  }

  protected isMine(itemId: string): boolean {
    const me = this.me();
    return !!me && this.claims().some((c) => c.item_id === itemId && c.participant_id === me);
  }

  protected myShares(itemId: string): number {
    const me = this.me();
    return this.claims().find((c) => c.item_id === itemId && c.participant_id === me)?.shares ?? 0;
  }

  private static readonly NO_ITEM: ItemBreakdown = {
    quantity: 1, claimedShares: 0, claimantCount: 0,
    eachPaise: 0, unclaimedUnits: 0, unclaimedPaise: 0, shared: false,
  };

  protected breakdown(itemId: string): ItemBreakdown {
    return this.split().perItem.get(itemId) ?? BillRoomPage.NO_ITEM;
  }

  protected dateLabel(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? iso
      : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  protected initials(name: string): string {
    return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
  }

  // ── actions ───────────────────────────────────────────────
  private async run(action: () => Promise<BillState | void>): Promise<void> {
    if (this.working()) return;
    this.working.set(true);
    this.actionError.set(null);
    try {
      const next = await action();
      if (next) this.state.set(next);
    } catch (error) {
      this.actionError.set(error instanceof Error ? error.message : 'That didn’t work. Try again.');
      await this.refresh(); // undo any optimistic change
    } finally {
      this.working.set(false);
    }
  }

  protected async joinNow(): Promise<void> {
    const name = this.myName.trim();
    if (!name) return;
    await this.run(async () => {
      const joined = await this.api.join(this.code, name);
      this.me.set(joined.participantId);
      return joined;
    });
  }

  protected async toggleClaim(item: BillItem): Promise<void> {
    const me = this.me();
    if (!me || !this.canClaim()) return;
    const mine = this.isMine(item.id);

    // Optimistic, so a tap feels instant; the server's push is authoritative.
    this.state.update((s) =>
      !s ? s : {
        ...s,
        claims: mine
          ? s.claims.filter((c) => !(c.item_id === item.id && c.participant_id === me))
          : [...s.claims, { item_id: item.id, participant_id: me, shares: 1 }],
      },
    );

    await this.run(() =>
      mine ? this.api.unclaim(this.code, item.id, me) : this.api.claim(this.code, item.id, me, 1),
    );
  }

  protected async changeShares(item: BillItem, delta: number): Promise<void> {
    const me = this.me();
    if (!me) return;
    const next = Math.min(item.quantity, Math.max(1, this.myShares(item.id) + delta));
    await this.run(() => this.api.claim(this.code, item.id, me, next));
  }

  protected async splitLeftovers(): Promise<void> {
    await this.run(() => this.api.splitLeftovers(this.code));
  }

  protected async addOffline(): Promise<void> {
    const name = this.offlineName.trim();
    if (!name) return;
    await this.run(async () => {
      const next = await this.api.addParticipant(this.code, name);
      this.offlineName = '';
      return next;
    });
  }

  protected async setStatus(person: PersonSplit, status: 'pending' | 'confirmed'): Promise<void> {
    await this.run(() => this.api.setPayment(this.code, person.participantId, status, person.totalPaise));
  }

  protected async markPaid(paid: boolean): Promise<void> {
    const me = this.me();
    if (!me) return;
    await this.run(async () => {
      const next = await this.api.setPayment(
        this.code,
        me,
        paid ? 'marked_paid' : 'pending',
        this.myTotalPaise(),
      );
      this.showPaySheet.set(false);
      return next;
    });
  }

  protected async settle(): Promise<void> {
    await this.run(() => this.api.settle(this.code));
  }

  protected async copyLink(): Promise<void> {
    if (await copyText(this.shareUrl())) {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }
  }

  protected async copyUpiId(): Promise<void> {
    if (await copyText(this.state()?.bill.payer_upi_id ?? '')) {
      this.copiedUpi.set(true);
      setTimeout(() => this.copiedUpi.set(false), 2000);
    }
  }

  protected async copyNudge(person: PersonSplit): Promise<void> {
    const bill = this.state()!.bill;
    const message =
      `Hi ${person.displayName}! Your share of ${bill.restaurant_name || 'the bill'} ` +
      `comes to ₹${(person.totalPaise / 100).toFixed(2)}. ` +
      `Details and pay link: ${this.shareUrl()}`;
    if (await copyText(message)) {
      this.nudged.set(person.participantId);
      setTimeout(() => this.nudged.set(null), 2000);
    }
  }

  protected async share(): Promise<void> {
    const bill = this.state()!.bill;
    await shareOrWhatsApp(
      'Smart Splitter',
      `Splitting ${bill.restaurant_name || 'our bill'} (₹${(bill.total_paise / 100).toFixed(2)}). Tap what you had:`,
      this.shareUrl(),
    );
  }
}
