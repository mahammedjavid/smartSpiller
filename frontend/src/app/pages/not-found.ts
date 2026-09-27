import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="card stack center">
        <h1>Page not found</h1>
        <p class="muted small">That link doesn't lead anywhere. Check it with whoever sent it.</p>
        <a class="btn btn-primary" routerLink="/">Go to Smart Splitter</a>
      </div>
    </div>
  `,
})
export class NotFoundPage {}
