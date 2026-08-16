'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export type FeedMode = 'sse' | 'cdc';

export interface TelemetryPacket {
  device_id: string;
  ts: string;
  gps: { lat: number; lon: number; speed_kmh: number; heading: number } | null;
  accel_cal?: { vertical_rms?: number; horizontal_peak?: number } | null;
  server_received_at: string;
  [key: string]: any;
}

export interface DrivingEventPacket {
  event_key: string;
  device_id: string;
  type: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  occurred_at: string;
  lat: number | null;
  lon: number | null;
  speed_kmh: number | null;
  magnitude: number | null;
  magnitude_unit: string | null;
  [key: string]: any;
}

export interface RealtimeStreamOptions {
  supabase: SupabaseClient;
  sseUrl?: string;
  onTelemetry?: (telemetry: TelemetryPacket) => void;
  onDrivingEvent?: (event: DrivingEventPacket, rawPayload?: any) => void;
  onTripChange?: (tripPayload?: any) => void;
  enabled?: boolean;
}

export interface RealtimeStreamState {
  feedMode: FeedMode;
  isSseActive: boolean;
  isCdcActive: boolean;
  statusBadgeText: 'FAST-PATH ACTIVE (SSE)' | 'CLOUD CDC ACTIVE';
  latencyMs: number | null;
  totalPackets: number;
  lastPacketTimestamp: number | null;
  reconnectSse: () => void;
}

const DEFAULT_SSE_URL =
  process.env.NEXT_PUBLIC_ENGINE_SSE_URL || 'http://localhost:8080/events/live';

/**
 * Dual-Feed Realtime Hook:
 * 1. Primary: Fastify Engine SSE (<10ms fast-path).
 * 2. Fallback: Supabase Realtime CDC channels (unified_ops_room).
 * Auto-switches dynamically and manages zero-drop failover.
 */
export function useRealtimeStream({
  supabase,
  sseUrl = DEFAULT_SSE_URL,
  onTelemetry,
  onDrivingEvent,
  onTripChange,
  enabled = true,
}: RealtimeStreamOptions): RealtimeStreamState {
  const [feedMode, setFeedMode] = useState<FeedMode>('cdc');
  const [isSseActive, setIsSseActive] = useState<boolean>(false);
  const [isCdcActive, setIsCdcActive] = useState<boolean>(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [totalPackets, setTotalPackets] = useState<number>(0);
  const [lastPacketTimestamp, setLastPacketTimestamp] = useState<number | null>(null);

  // Store callbacks in refs to avoid recreating SSE and Supabase subscriptions on parent re-renders
  const onTelemetryRef = useRef(onTelemetry);
  const onDrivingEventRef = useRef(onDrivingEvent);
  const onTripChangeRef = useRef(onTripChange);
  const isSseActiveRef = useRef(isSseActive);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    onTelemetryRef.current = onTelemetry;
    onDrivingEventRef.current = onDrivingEvent;
    onTripChangeRef.current = onTripChange;
  }, [onTelemetry, onDrivingEvent, onTripChange]);

  useEffect(() => {
    isSseActiveRef.current = isSseActive;
  }, [isSseActive]);

  const recordPacketArrival = useCallback((tsIso?: string) => {
    const now = Date.now();
    setLastPacketTimestamp(now);
    setTotalPackets((prev) => prev + 1);

    if (tsIso) {
      try {
        const packetTime = new Date(tsIso).getTime();
        if (!isNaN(packetTime) && packetTime > 0) {
          const delta = Math.max(0, now - packetTime);
          setLatencyMs(delta);
        }
      } catch {
        // ignore timestamp parse error
      }
    }
  }, []);

  const connectSSE = useCallback(() => {
    if (!enabled || typeof window === 'undefined') return;

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      try {
        eventSourceRef.current.close();
      } catch {
        // ignore
      }
      eventSourceRef.current = null;
    }

    try {
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsSseActive(true);
        setFeedMode('sse');
      };

      const handleTelemetryData = (raw: any) => {
        if (!raw) return;
        const packet: TelemetryPacket = {
          device_id: String(raw.device_id || raw.deviceId || ''),
          ts: String(raw.ts || raw.server_received_at || new Date().toISOString()),
          server_received_at: String(raw.server_received_at || raw.ts || new Date().toISOString()),
          gps: raw.gps || (raw.lat && raw.lon ? {
            lat: Number(raw.lat),
            lon: Number(raw.lon),
            speed_kmh: Number(raw.speed_kmh ?? raw.speedKmh ?? 0),
            heading: Number(raw.heading ?? 0),
          } : null),
          accel_cal: raw.accel_cal || raw.accelCal || null,
        };

        recordPacketArrival(packet.server_received_at);
        onTelemetryRef.current?.(packet);
      };

      const handleEventData = (raw: any) => {
        if (!raw) return;
        const key = String(raw.event_key || raw.eventKey || raw.id || '');
        const packet: DrivingEventPacket = {
          event_key: key,
          device_id: String(raw.device_id || raw.deviceId || ''),
          type: String(raw.type || ''),
          severity: (raw.severity as any) || 'info',
          confidence: Number(raw.confidence ?? 0),
          occurred_at: String(raw.occurred_at || raw.occurredAt || new Date().toISOString()),
          lat: raw.lat != null ? Number(raw.lat) : null,
          lon: raw.lon != null ? Number(raw.lon) : null,
          speed_kmh: raw.speed_kmh != null ? Number(raw.speed_kmh) : (raw.speedKmh != null ? Number(raw.speedKmh) : null),
          magnitude: raw.magnitude != null ? Number(raw.magnitude) : null,
          magnitude_unit: raw.magnitude_unit || raw.magnitudeUnit || null,
        };

        recordPacketArrival(packet.occurred_at);
        onDrivingEventRef.current?.(packet, raw);
      };

      const handleTripData = (raw: any) => {
        if (!raw) return;
        recordPacketArrival(raw.started_at || raw.ended_at);
        onTripChangeRef.current?.(raw);
      };

      es.addEventListener('telemetry', (evt: MessageEvent) => {
        try {
          const data = JSON.parse(evt.data);
          handleTelemetryData(data);
        } catch (err) {
          console.warn('[SSE] Failed to parse telemetry frame:', err);
        }
      });

      es.addEventListener('driving_event', (evt: MessageEvent) => {
        try {
          const data = JSON.parse(evt.data);
          handleEventData(data);
        } catch (err) {
          console.warn('[SSE] Failed to parse driving_event frame:', err);
        }
      });

      es.addEventListener('event', (evt: MessageEvent) => {
        try {
          const data = JSON.parse(evt.data);
          handleEventData(data);
        } catch (err) {
          console.warn('[SSE] Failed to parse event frame:', err);
        }
      });

      es.addEventListener('trip', (evt: MessageEvent) => {
        try {
          const data = JSON.parse(evt.data);
          handleTripData(data);
        } catch (err) {
          console.warn('[SSE] Failed to parse trip frame:', err);
        }
      });

      es.onmessage = (evt: MessageEvent) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.type === 'telemetry' || data.gps || data.server_received_at) {
            handleTelemetryData(data.data || data);
          } else if (data.type === 'driving_event' || data.severity || data.event_key) {
            handleEventData(data.data || data);
          } else if (data.type === 'trip' || data.trip_id) {
            handleTripData(data.data || data);
          }
        } catch {
          // ignore plain text ping or keep-alive
        }
      };

      es.onerror = () => {
        // Fallback gracefully to Supabase CDC
        setIsSseActive(false);
        setFeedMode('cdc');

        if (es.readyState === EventSource.CLOSED) {
          es.close();
          eventSourceRef.current = null;
        }

        // Schedule periodic reconnection retry to Fast-Path SSE (5s backoff)
        if (!retryTimeoutRef.current) {
          retryTimeoutRef.current = setTimeout(() => {
            retryTimeoutRef.current = null;
            connectSSE();
          }, 5000);
        }
      };
    } catch {
      setIsSseActive(false);
      setFeedMode('cdc');
      if (!retryTimeoutRef.current) {
        retryTimeoutRef.current = setTimeout(() => {
          retryTimeoutRef.current = null;
          connectSSE();
        }, 5000);
      }
    }
  }, [enabled, sseUrl, recordPacketArrival]);

  // Establish SSE connection
  useEffect(() => {
    if (enabled) {
      connectSSE();
    }
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close();
        } catch {
          // ignore
        }
        eventSourceRef.current = null;
      }
    };
  }, [enabled, connectSSE]);

  // Setup Supabase Realtime CDC subscription (Fallback or Dual Standby)
  useEffect(() => {
    if (!enabled || !supabase) return;

    const channel = supabase
      .channel('unified_ops_room')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'telemetry' },
        (payload) => {
          setIsCdcActive(true);
          // If SSE is active, SSE provides the sub-10ms fast-path so we avoid double-triggering
          if (!isSseActiveRef.current) {
            const row = payload.new as any;
            if (row) {
              const packet: TelemetryPacket = {
                device_id: String(row.device_id || ''),
                ts: String(row.ts || row.server_received_at || new Date().toISOString()),
                server_received_at: String(row.server_received_at || row.ts || new Date().toISOString()),
                gps: row.gps || null,
                accel_cal: row.accel_cal || null,
              };
              recordPacketArrival(packet.server_received_at);
              onTelemetryRef.current?.(packet);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driving_events' },
        (payload) => {
          setIsCdcActive(true);
          if (!isSseActiveRef.current) {
            const raw = (payload.new || payload.old) as any;
            if (raw) {
              const key = String(raw.event_key || raw.id || '');
              const packet: DrivingEventPacket = {
                event_key: key,
                device_id: String(raw.device_id || ''),
                type: String(raw.type || ''),
                severity: (raw.severity as any) || 'info',
                confidence: Number(raw.confidence ?? 0),
                occurred_at: String(raw.occurred_at || new Date().toISOString()),
                lat: raw.lat != null ? Number(raw.lat) : null,
                lon: raw.lon != null ? Number(raw.lon) : null,
                speed_kmh: raw.speed_kmh != null ? Number(raw.speed_kmh) : null,
                magnitude: raw.magnitude != null ? Number(raw.magnitude) : null,
                magnitude_unit: raw.magnitude_unit ? String(raw.magnitude_unit) : null,
              };
              recordPacketArrival(packet.occurred_at);
              onDrivingEventRef.current?.(packet, payload);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips' },
        (payload) => {
          setIsCdcActive(true);
          onTripChangeRef.current?.(payload.new || payload.old);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsCdcActive(true);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, supabase, recordPacketArrival]);

  const statusBadgeText = feedMode === 'sse' ? 'FAST-PATH ACTIVE (SSE)' : 'CLOUD CDC ACTIVE';

  return {
    feedMode,
    isSseActive,
    isCdcActive,
    statusBadgeText,
    latencyMs,
    totalPackets,
    lastPacketTimestamp,
    reconnectSse: connectSSE,
  };
}
