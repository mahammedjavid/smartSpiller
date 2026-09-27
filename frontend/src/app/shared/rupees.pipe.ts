import { Pipe, type PipeTransform } from '@angular/core';
import { formatPaise } from '../core/money';

/** {{ 40700 | rupees }} → ₹407.00 */
@Pipe({ name: 'rupees' })
export class RupeesPipe implements PipeTransform {
  transform(paise: number | null | undefined): string {
    return formatPaise(paise ?? 0);
  }
}
