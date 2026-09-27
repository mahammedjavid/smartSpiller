import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import type { BillState, DraftItem, ScanResult } from './models';

/** Carries copy that is always safe to show a person (NFR-3). */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Who you are on a given bill lives entirely in this browser. The share link is
 * the credential: hold the owner token and you get the payer's controls, hold a
 * participant id and you are that person.
 */
export const identity = {
  ownerToken: (code: string) => localStorage.getItem(`ss:owner:${code}`),
  setOwnerToken: (code: string, token: string) => localStorage.setItem(`ss:owner:${code}`, token),
  participantId: (code: string) => localStorage.getItem(`ss:me:${code}`),
  setParticipantId: (code: string, id: string) => localStorage.setItem(`ss:me:${code}`, id),
  name: () => localStorage.getItem('ss:name') ?? '',
  setName: (name: string) => localStorage.setItem('ss:name', name),

  recent(): Array<{ code: string; title: string }> {
    try {
      return JSON.parse(localStorage.getItem('ss:bills') ?? '[]');
    } catch {
      return [];
    }
  },
  remember(code: string, title: string) {
    const list = identity.recent().filter((b) => b.code !== code);
    list.unshift({ code, title });
    localStorage.setItem('ss:bills', JSON.stringify(list.slice(0, 12)));
  },
};

@Injectable({ providedIn: 'root' })
export class Api {
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    code?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    // Sent on every call; the server only checks it where it matters.
    const owner = code ? identity.ownerToken(code) : null;
    if (owner) headers['X-Owner-Token'] = owner;

    let response: Response;
    try {
      response = await fetch(`${environment.apiBaseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('NETWORK', 'Couldn’t reach the server. Check your connection.');
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(
        payload?.error?.code ?? 'UNKNOWN',
        payload?.error?.message ?? 'Something went wrong. Please try again.',
      );
    }
    return payload as T;
  }

  warmUp(): void {
    fetch(`${environment.apiBaseUrl}/health`).catch(() => undefined);
  }

  // ── bills ───────────────────────────────────────────────────
  async createBill(input: {
    source: 'scan' | 'manual';
    restaurantName?: string | null;
    billDate?: string | null;
    items?: DraftItem[];
    charges?: Partial<Record<'taxPaise' | 'serviceChargePaise' | 'tipPaise' | 'discountPaise' | 'roundOffPaise', number>>;
  }): Promise<BillState & { code: string; ownerToken: string }> {
    const created = await this.request<BillState & { code: string; ownerToken: string }>(
      'POST',
      '/bills',
      input,
    );
    identity.setOwnerToken(created.code, created.ownerToken);
    identity.remember(created.code, created.bill.restaurant_name ?? created.bill.title);
    return created;
  }

  getBill(code: string): Promise<BillState> {
    return this.request<BillState>('GET', `/bills/${code}`, undefined, code);
  }

  saveBill(
    code: string,
    body: {
      title: string;
      restaurantName: string | null;
      billDate: string | null;
      payerName: string;
      payerUpiId: string;
      charges: Record<string, number>;
      items: DraftItem[];
    },
  ): Promise<BillState> {
    return this.request<BillState>('PUT', `/bills/${code}`, body, code);
  }

  async openBill(code: string): Promise<BillState & { participantId: string }> {
    const opened = await this.request<BillState & { participantId: string }>(
      'POST',
      `/bills/${code}/open`,
      {},
      code,
    );
    identity.setParticipantId(code, opened.participantId);
    return opened;
  }

  settle(code: string): Promise<BillState> {
    return this.request<BillState>('POST', `/bills/${code}/settle`, {}, code);
  }

  async join(code: string, name: string): Promise<BillState & { participantId: string }> {
    const joined = await this.request<BillState & { participantId: string }>(
      'POST',
      `/bills/${code}/join`,
      { name, participantId: identity.participantId(code) ?? undefined },
      code,
    );
    identity.setParticipantId(code, joined.participantId);
    identity.setName(name);
    identity.remember(code, joined.bill.restaurant_name ?? joined.bill.title);
    return joined;
  }

  addParticipant(code: string, name: string): Promise<BillState> {
    return this.request<BillState>('POST', `/bills/${code}/participants`, { name }, code);
  }

  claim(code: string, itemId: string, participantId: string, shares = 1): Promise<BillState> {
    return this.request<BillState>('PUT', `/bills/${code}/claims`, { itemId, participantId, shares }, code);
  }

  unclaim(code: string, itemId: string, participantId: string): Promise<BillState> {
    return this.request<BillState>('DELETE', `/bills/${code}/claims`, { itemId, participantId }, code);
  }

  splitLeftovers(code: string): Promise<BillState> {
    return this.request<BillState>('POST', `/bills/${code}/leftovers`, {}, code);
  }

  setPayment(
    code: string,
    participantId: string,
    status: 'pending' | 'marked_paid' | 'confirmed',
    amountPaise?: number,
  ): Promise<BillState> {
    return this.request<BillState>(
      'POST',
      `/bills/${code}/payment`,
      { participantId, status, amountPaise },
      code,
    );
  }

  async scan(file: File, signal?: AbortSignal): Promise<ScanResult> {
    const body = new FormData();
    body.append('image', file);

    let response: Response;
    try {
      response = await fetch(`${environment.apiBaseUrl}/scan`, { method: 'POST', body, signal });
    } catch {
      if (signal?.aborted) throw new ApiError('ABORTED', 'Scan cancelled.');
      throw new ApiError('NETWORK', 'Couldn’t reach the server. Check your connection.');
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(
        payload?.error?.code ?? 'SCAN_FAILED',
        payload?.error?.message ?? 'Couldn’t read the bill right now.',
      );
    }
    return payload as ScanResult;
  }

  /**
   * Live updates. The server pushes the whole room on every change, so the
   * caller just replaces its state. EventSource reconnects on its own.
   */
  stream(
    code: string,
    onState: (state: BillState) => void,
    onConnected: (connected: boolean) => void,
  ): () => void {
    const source = new EventSource(`${environment.apiBaseUrl}/bills/${code}/stream`);

    source.onopen = () => onConnected(true);
    source.onerror = () => onConnected(false);
    source.onmessage = (event) => {
      try {
        const state = JSON.parse(event.data) as BillState | null;
        if (state) {
          onConnected(true);
          onState(state);
        }
      } catch {
        /* ignore a malformed frame — the next one will be complete */
      }
    };

    return () => source.close();
  }
}
