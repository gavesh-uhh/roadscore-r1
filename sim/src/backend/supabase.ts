/**
 * Supabase Telemetry Ingestion Client with Async Queue & Connection Monitoring
 */

import type { TelemetryRow } from '../types.js';

export interface SupabaseClientOptions {
  supabaseUrl: string;
  supabaseKey: string;
  offlineMode?: boolean;
  onStatusChange?: (status: 'OK' | 'OFFLINE' | 'SENDING' | 'CONNECTING') => void;
  onError?: (err: Error) => void;
}

export class SupabaseIngestClient {
  private readonly url: string;
  private readonly key: string;
  private readonly offlineMode: boolean;
  private status: 'OK' | 'OFFLINE' | 'SENDING' | 'CONNECTING' = 'CONNECTING';
  private totalSent = 0;
  private totalFailed = 0;
  private isProcessing = false;
  private queue: TelemetryRow[] = [];
  private onStatusChange?: (status: 'OK' | 'OFFLINE' | 'SENDING' | 'CONNECTING') => void;
  private onError?: (err: Error) => void;

  constructor(options: SupabaseClientOptions) {
    this.url = options.supabaseUrl.replace(/\/$/, '');
    this.key = options.supabaseKey;
    this.offlineMode = options.offlineMode ?? false;
    this.onStatusChange = options.onStatusChange;
    this.onError = options.onError;

    if (this.offlineMode || !this.key) {
      this.setStatus('OFFLINE');
    } else {
      this.testConnection();
    }
  }

  private setStatus(status: 'OK' | 'OFFLINE' | 'SENDING' | 'CONNECTING'): void {
    if (this.status !== status) {
      this.status = status;
      this.onStatusChange?.(status);
    }
  }

  public getStatus(): 'OK' | 'OFFLINE' | 'SENDING' | 'CONNECTING' {
    return this.status;
  }

  public getTotalSent(): number {
    return this.totalSent;
  }

  public getTotalFailed(): number {
    return this.totalFailed;
  }

  public async testConnection(): Promise<boolean> {
    if (this.offlineMode || !this.key) {
      this.setStatus('OFFLINE');
      return false;
    }

    try {
      const endpoint = `${this.url}/rest/v1/telemetry?select=id&limit=1`;
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${this.key}`,
        },
      });

      if (res.ok) {
        this.setStatus('OK');
        return true;
      } else {
        this.setStatus('OFFLINE');
        return false;
      }
    } catch (err: any) {
      this.setStatus('OFFLINE');
      return false;
    }
  }

  public enqueueRow(row: TelemetryRow): void {
    if (this.offlineMode || !this.key) {
      // In offline mode, count sent locally for demo stats
      this.totalSent++;
      return;
    }

    this.queue.push(row);
    // Limit queue size to avoid memory growth if disconnected
    if (this.queue.length > 500) {
      this.queue.splice(0, this.queue.length - 500);
    }

    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;
    this.setStatus('SENDING');

    while (this.queue.length > 0) {
      // Batch up to 10 rows
      const batch = this.queue.splice(0, 10);
      try {
        const endpoint = `${this.url}/rest/v1/telemetry`;
        const payload = batch.map((r) => {
          const { id, server_received_at, source, ...rest } = r as any;
          return {
            ...rest,
            window_ms: rest.window_ms ?? 1000,
          };
        });

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: this.key,
            Authorization: `Bearer ${this.key}`,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(payload.length === 1 ? payload[0] : payload),
        });

        if (res.ok) {
          this.totalSent += batch.length;
          this.setStatus('OK');
        } else {
          this.totalFailed += batch.length;
          const text = await res.text();
          this.onError?.(new Error(`Supabase POST returned ${res.status}: ${text}`));
          this.setStatus('OFFLINE');
        }
      } catch (err: any) {
        this.totalFailed += batch.length;
        this.onError?.(err);
        this.setStatus('OFFLINE');
        break;
      }
    }

    this.isProcessing = false;
  }
}
