import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import QRCode from 'qrcode';

@Component({
  selector: 'app-qr-code',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dataUrl(); as src) {
      <img [src]="src" [width]="size()" [height]="size()" [alt]="alt()" />
    } @else {
      <div class="skeleton" [style.width.px]="size()" [style.height.px]="size()"></div>
    }
  `,
  styles: `
    :host { display: inline-block; line-height: 0; }
    img { border-radius: 8px; background: #fff; }
  `,
})
export class QrCodeComponent {
  readonly value = input.required<string>();
  readonly size = input(200);
  readonly alt = input('QR code');
  protected readonly dataUrl = signal<string | null>(null);

  constructor() {
    effect(() => {
      const value = this.value();
      const size = this.size();
      QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M' })
        .then((url) => this.dataUrl.set(url))
        .catch(() => this.dataUrl.set(null));
    });
  }
}
