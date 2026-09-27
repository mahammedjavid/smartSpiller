import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, ApiError, identity } from '../core/api';

@Component({
  selector: 'app-landing',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page stack-l">
      <header class="hero stack-s">
        <div class="logo" aria-hidden="true">₹</div>
        <h1>Smart Splitter</h1>
        <p class="muted">
          Snap the bill, share the link, everyone taps what they ate.
          Tax and service charge split fairly — to the paisa.
        </p>
      </header>

      @if (busy()) {
        <div class="card stack center" aria-live="polite">
          <div class="scan-anim" aria-hidden="true"><div class="beam"></div></div>
          <p class="strong">{{ progress() }}</p>
          <p class="small muted">This usually takes about ten seconds.</p>
          <button class="btn btn-ghost" type="button" (click)="cancel()">Cancel</button>
        </div>
      } @else {
        @if (error(); as message) {
          <div class="banner banner-danger stack-s" role="alert">
            <p class="strong">{{ message }}</p>
            <div class="row wrap">
              <button class="btn btn-sm btn-ghost" type="button" (click)="picker.click()">Try again</button>
              <button class="btn btn-sm btn-ghost" type="button" (click)="startManual()">Enter manually</button>
            </div>
          </div>
        }

        <div class="stack">
          <button class="card option primary" type="button" (click)="picker.click()">
            <span class="icon" aria-hidden="true">📷</span>
            <span class="stack-s grow">
              <span class="strong">Scan the bill</span>
              <span class="small muted">Photograph it — the items fill themselves in</span>
            </span>
            <span class="chev" aria-hidden="true">›</span>
          </button>

          <button class="card option" type="button" (click)="startManual()" [disabled]="creating()">
            <span class="icon quiet" aria-hidden="true">✏️</span>
            <span class="stack-s grow">
              <span class="strong">Enter manually</span>
              <span class="small muted">Type the items yourself — about a minute</span>
            </span>
            <span class="chev" aria-hidden="true">›</span>
          </button>
        </div>

        @if (recent().length) {
          <section class="stack-s">
            <div class="section-head"><h2>Recent</h2></div>
            @for (entry of recent(); track entry.code) {
              <a class="card-flat row recent" [routerLink]="['/b', entry.code]">
                <span class="grow truncate strong">{{ entry.title }}</span>
                <code class="chip chip-quiet">{{ entry.code }}</code>
                <span class="chev" aria-hidden="true">›</span>
              </a>
            }
          </section>
        }

        <section class="stack-s">
          <div class="step"><span class="num">1</span> Photograph the bill — the items fill themselves in</div>
          <div class="step"><span class="num">2</span> Share the QR code, friends tap what they had</div>
          <div class="step"><span class="num">3</span> Everyone pays you back over UPI, in one tap</div>
        </section>

        <p class="tiny dim center">No accounts. No sign-up. Your bill photo is never stored.</p>
      }

      <input
        #picker class="sr-only" type="file"
        accept="image/jpeg,image/png,image/webp" capture="environment"
        (change)="onFile($event)" />
    </div>
  `,
  styles: `
    .hero { padding: 22px 0 2px; text-align: center; align-items: center; }
    .logo {
      width: 56px; height: 56px; border-radius: 17px;
      background: var(--brand); color: var(--brand-ink);
      display: grid; place-items: center; font-size: 1.65rem; font-weight: 800;
      box-shadow: var(--shadow-2);
    }
    .hero h1 { font-size: 1.75rem; }
    .hero p { max-width: 32ch; margin: 0 auto; font-size: 0.9375rem; }

    .option {
      display: flex; align-items: center; gap: 14px; width: 100%;
      text-align: left; font: inherit; color: inherit; cursor: pointer; min-height: 86px;
      transition: border-color 140ms var(--ease), transform 90ms var(--ease);
    }
    .option:hover:not(:disabled) { border-color: var(--brand-line); }
    .option:active:not(:disabled) { transform: scale(0.99); }
    .option:disabled { opacity: 0.5; cursor: progress; }
    .option.primary { border-color: var(--brand-line); }

    .icon {
      width: 48px; height: 48px; border-radius: 14px; flex: none;
      background: var(--brand-soft); display: grid; place-items: center; font-size: 1.35rem;
    }
    .icon.quiet { background: var(--surface-2); }
    .chev { color: var(--ink-3); font-size: 1.4rem; line-height: 1; flex: none; }

    a.card-flat { color: inherit; text-decoration: none; }
    .recent { transition: border-color 140ms var(--ease); }
    .recent:hover { border-color: var(--brand-line); }

    .scan-anim {
      width: 100%; height: 104px; border-radius: var(--r);
      background: var(--surface-2); position: relative; overflow: hidden;
    }
    .beam {
      position: absolute; left: 0; right: 0; height: 3px;
      background: var(--brand); box-shadow: 0 0 16px var(--brand);
      animation: sweep 1.4s ease-in-out infinite alternate;
    }
    @keyframes sweep { from { top: 8%; } to { top: 92%; } }

    .step { display: flex; gap: 11px; align-items: center; font-size: 0.875rem; color: var(--ink-2); }
    .num {
      width: 23px; height: 23px; border-radius: 999px; flex: none;
      background: var(--brand-soft); color: var(--brand);
      display: grid; place-items: center; font-size: 0.75rem; font-weight: 750;
    }
  `,
})
export class LandingPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);
  protected readonly creating = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly progress = signal('Reading your bill…');
  protected readonly recent = signal(identity.recent());
  private controller: AbortController | null = null;

  constructor() {
    this.api.warmUp();
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // let them re-pick the same photo after an error
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      this.error.set('That photo is larger than 8 MB. Try a smaller one.');
      return;
    }

    this.error.set(null);
    this.busy.set(true);
    this.progress.set('Reading your bill…');
    this.controller = new AbortController();
    const wakeNotice = setTimeout(() => this.progress.set('Waking up the server…'), 5000);

    try {
      const scan = await this.api.scan(file, this.controller.signal);
      const created = await this.api.createBill({
        source: 'scan',
        restaurantName: scan.restaurantName,
        billDate: scan.billDate,
        items: scan.items,
        charges: {
          taxPaise: scan.taxPaise,
          serviceChargePaise: scan.serviceChargePaise,
          tipPaise: scan.tipPaise,
          discountPaise: scan.discountPaise,
          roundOffPaise: scan.roundOffPaise,
        },
      });
      sessionStorage.setItem(`scan-warnings:${created.code}`, JSON.stringify(scan.warnings));
      await this.router.navigate(['/b', created.code, 'review']);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ABORTED') return;
      this.error.set(error instanceof Error ? error.message : 'Couldn’t read the bill right now.');
    } finally {
      clearTimeout(wakeNotice);
      this.busy.set(false);
      this.controller = null;
    }
  }

  protected cancel(): void {
    this.controller?.abort();
    this.busy.set(false);
  }

  protected async startManual(): Promise<void> {
    if (this.creating()) return;
    this.creating.set(true);
    this.error.set(null);
    try {
      const created = await this.api.createBill({ source: 'manual' });
      await this.router.navigate(['/b', created.code, 'review']);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Couldn’t start a bill.');
    } finally {
      this.creating.set(false);
    }
  }
}
