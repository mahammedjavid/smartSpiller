import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, identity } from '../core/api';

@Component({
  selector: 'app-join',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="card stack">
        <h1>Join the split</h1>
        <p class="muted small">Enter your name so your friends know which items are yours. No sign-up needed.</p>

        <form class="stack" (ngSubmit)="join()">
          <div>
            <label for="name">Your name</label>
            <input id="name" name="name" [(ngModel)]="displayName" maxlength="40" required
                   autocomplete="given-name" placeholder="Bhavna" autofocus />
          </div>

          @if (error(); as message) {
            <div class="banner banner-danger stack-s" role="alert">
              <p>{{ message }}</p>
              <a class="btn btn-sm btn-ghost" routerLink="/">Go to Smart Splitter</a>
            </div>
          }

          <button class="btn btn-primary btn-block" type="submit" [disabled]="busy() || !displayName.trim()">
            @if (busy()) { <span class="spinner"></span> }
            Join
          </button>
        </form>
      </div>
    </div>
  `,
})
export class JoinPage {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly code = (this.route.snapshot.paramMap.get('code') ?? '').toUpperCase();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  // A returning guest on the same device gets their name back.
  protected displayName = identity.name();

  protected async join(): Promise<void> {
    const name = this.displayName.trim();
    if (!name || this.busy()) return;

    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.join(this.code, name);
      await this.router.navigate(['/b', this.code]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Couldn’t join this bill.');
    } finally {
      this.busy.set(false);
    }
  }
}
